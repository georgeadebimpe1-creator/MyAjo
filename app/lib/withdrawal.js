// app/lib/withdrawal.js
//
// Withdrawal I/O — reads/writes cycles and payouts. Kept separate from
// withdrawalLogic.js so the fee math stays pure and testable.
//
// Uses supabaseAdmin (service role key), not the anon-key client — same
// RLS reasoning as the other server-side files. Most writes here already
// checked for errors; the two writes that run AFTER payoutFn succeeds
// (updating the cycle, marking the payout completed) did not, which is
// the riskiest place in the whole app for a silent failure: if either
// of those silently fails, the money has already moved but the database
// still shows the payout as 'pending' or the cycle as 'active'.

import { supabaseAdmin } from './supabase'
import { quoteWithdrawal, isCycleComplete } from './withdrawalLogic'
import { sendAdminAlert } from './alerts'
import { getCycleDayNumber } from './savings'
import { getWithdrawalHold } from './bankChange'

/**
 * Withdrawable balance = total_saved minus the locked commission minus
 * every completed payout already taken this cycle. Computed live so it
 * can never drift out of sync with total_saved as new contributions land.
 */
export async function getWithdrawableBalance(cycle) {
  const { data: priorPayouts, error } = await supabaseAdmin
    .from('payouts')
    .select('gross_amount')
    .eq('cycle_id', cycle.id)
    .eq('status', 'completed')

  if (error) throw new Error('Could not calculate withdrawable balance.')

  const alreadyWithdrawn = (priorPayouts || []).reduce(
    (sum, p) => sum + parseFloat(p.gross_amount),
    0
  )
  const commission = parseFloat(cycle.commission || 0)
  const totalSaved = parseFloat(cycle.total_saved || 0)

  return Math.max(totalSaved - commission - alreadyWithdrawn, 0)
}

/**
 * Step 1: get a quote for a requested withdrawal amount against a cycle.
 * Does NOT move money.
 */
export async function quoteWithdrawalForCycle(cycle, requestedAmount) {
  const user = await loadBankChangeState(cycle.user_id)

  // Paused for 24h after a bank change — tell the trader before they
  // go any further, not only at the last step.
  const hold = getWithdrawalHold(user)
  if (hold.held) {
    return { allowed: false, reason: hold.message }
  }

  const withdrawableBalance = await getWithdrawableBalance(cycle)
  return quoteWithdrawal({
    requestedAmount,
    cycleDayNumber: getCycleDayNumber(cycle.start_date),
    withdrawableBalance,
    bankChangeFeeOwed: user?.bank_change_fee_owed || 0,
  })
}

// The two bank-change fields on the trader's row. Returns null if the
// lookup fails — callers treat that as "no hold, nothing owed", except
// processWithdrawal, which refuses to continue (see below), because a
// hold must fail CLOSED where money actually moves.
async function loadBankChangeState(userId) {
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('last_bank_change_at, bank_change_fee_owed')
    .eq('id', userId)
    .single()

  if (error) {
    console.error('loadBankChangeState: could not read user', userId, error)
    return null
  }
  return data
}

/**
 * Step 2: actually process a withdrawal — logs it in payouts, calls the
 * payout function, updates the cycle. Re-validates against live data,
 * since balance may have changed since the quote was first shown.
 *
 * payoutFn is injected — swap stubPayout for Anchor's real disbursement
 * call once sandbox access is live, with no other changes needed here.
 */
export async function processWithdrawal(cycleId, requestedAmount, payoutFn) {
  const { data: cycle, error: cycleErr } = await supabaseAdmin
    .from('cycles')
    .select('*')
    .eq('id', cycleId)
    .single()

  if (cycleErr || !cycle) {
    return { success: false, reason: 'Cycle not found. It may have already ended.' }
  }

  // Fail CLOSED: if we cannot read the bank-change state, we cannot
  // know whether a hold applies, so no money moves. (`held: true` also
  // stops the daily day-30 sweep raising a "failed" alert for what is
  // really an intentional pause.)
  const bankState = await loadBankChangeState(cycle.user_id)
  if (!bankState) {
    return { success: false, reason: 'We could not check your account status right now. Please try again shortly.' }
  }

  const hold = getWithdrawalHold(bankState)
  if (hold.held) {
    return { success: false, held: true, reason: hold.message }
  }

  const withdrawableBalance = await getWithdrawableBalance(cycle)
  const freshQuote = quoteWithdrawal({
    requestedAmount,
    cycleDayNumber: getCycleDayNumber(cycle.start_date),
    withdrawableBalance,
    bankChangeFeeOwed: bankState.bank_change_fee_owed || 0,
  })

  if (!freshQuote.allowed) {
    return { success: false, reason: freshQuote.reason }
  }

  // COMMISSION LOCK: the commission is held back from the withdrawable
  // balance from the first payment (see getWithdrawableBalance), so the
  // trader can never withdraw it, and it stays in their own account while
  // the cycle runs. A withdrawal before day 30, even one that takes
  // everything allowed, does not end the cycle and does not touch the
  // commission. It is collected here only when the cycle completes on day 30.
  // (If there is nothing left to pay out at day 30, see
  // collectRemainingCommission below.)
  const endsCycleNow = freshQuote.payoutType === 'cycle_completion'
  const commission = endsCycleNow ? parseFloat(cycle.commission) : 0
  const bankChangeFee = freshQuote.bankChangeFee || 0

  // RETRY PROTECTION: if an earlier attempt for this cycle already moved the
  // commission to MyAjo and then failed later (for example the bank transfer
  // to the trader failed), do not move it a second time. Only attempts that
  // recorded a commission above zero count, so a partial withdrawal that only
  // collected a bank change fee is not mistaken for a commission sweep.
  // If we cannot check, we stop: charging twice is worse than waiting.
  let skipCommissionSweep = false
  if (commission > 0) {
    const { data: priorSweeps, error: priorSweepErr } = await supabaseAdmin
      .from('payouts')
      .select('id')
      .eq('cycle_id', cycle.id)
      .eq('commission_swept', true)
      .gt('commission', 0)
      .limit(1)

    if (priorSweepErr) {
      console.error('processWithdrawal: could not check for an earlier commission sweep', cycle.id, priorSweepErr)
      return { success: false, reason: 'We could not check your account right now. Please try again shortly.' }
    }
    skipCommissionSweep = (priorSweeps || []).length > 0
  }

  const { data: payout, error: insertErr } = await supabaseAdmin
    .from('payouts')
    .insert([{
      cycle_id: cycle.id,
      user_id: cycle.user_id,
      gross_amount: freshQuote.requestedAmount,
      commission,
      net_amount: freshQuote.netAmount,
      payout_type: freshQuote.payoutType,
      withdrawal_fee: freshQuote.fee,
      bank_change_fee: bankChangeFee,
      fee_reason: freshQuote.feeReason,
      status: 'pending',
      initiated_at: new Date().toISOString(),
    }])
    .select()
    .single()

  if (insertErr) {
    return { success: false, reason: 'Could not log this withdrawal. Please try again.' }
  }

  // The bank change fee is swept to MyAjo the same way commission is
  // (a book transfer out of the trader's account just before the bank
  // payout), so it is added to the `commission` argument here. The
  // payouts.commission column above still records commission only.
  const payoutResult = await payoutFn({ userId: cycle.user_id, amount: freshQuote.netAmount, commission: commission + bankChangeFee, skipCommissionSweep })

  if (!payoutResult.success) {
    const { error: failUpdateErr } = await supabaseAdmin
      .from('payouts')
      .update({
        status: 'failed',
        failed_reason: payoutResult.reason || 'Unknown error',
        commission_swept: !!payoutResult.commissionSwept,
      })
      .eq('id', payout.id)

    if (failUpdateErr) {
      console.error('processWithdrawal: could not mark payout failed', payout.id, failUpdateErr)
      if (payoutResult.commissionSwept) {
        await sendAdminAlert(
          'Commission moved but could not be recorded',
          `A payout failed AFTER the commission had already been moved to MyAjo, and that fact could not be saved.\n\nPayout ID: ${payout.id}\nCycle ID: ${cycle.id}\nSupabase error: ${failUpdateErr.message || JSON.stringify(failUpdateErr)}\n\nSet payouts.commission_swept = true for this payout by hand, otherwise a retry could collect the commission a second time.`
        )
      }
    }
    return { success: false, reason: 'The payout could not be completed. Please try again shortly, or contact support.' }
  }

  // Money has moved and the fee was taken — clear it from what is owed.
  // If this write fails the trader would be charged again next payout,
  // so alert loudly for manual correction.
  if (bankChangeFee > 0) {
    const remainingOwed = Math.max(0, parseFloat(bankState.bank_change_fee_owed || 0) - bankChangeFee)
    const { error: feeClearErr } = await supabaseAdmin
      .from('users')
      .update({ bank_change_fee_owed: remainingOwed })
      .eq('id', cycle.user_id)

    if (feeClearErr) {
      console.error('processWithdrawal: PAYOUT SUCCEEDED but bank change fee owed was not cleared', { userId: cycle.user_id, payoutId: payout.id, error: feeClearErr })
      await sendAdminAlert(
        'Bank change fee not cleared after payout',
        `A payout deducted a N${bankChangeFee} bank change fee, but the trader's "fee owed" could not be reduced.\n\nUser ID: ${cycle.user_id}\nPayout ID: ${payout.id}\nShould now be owed: N${remainingOwed}\nSupabase error: ${feeClearErr.message || JSON.stringify(feeClearErr)}\n\nFix users.bank_change_fee_owed by hand, or they will be charged the fee again at their next payout.`
      )
    }
  }

  // Only a day-30 completion ends the cycle. A withdrawal that empties the
  // withdrawable balance earlier leaves the cycle active, so the trader can
  // keep saving and the reserved commission is collected on day 30.
  const cycleEnding = freshQuote.payoutType === 'cycle_completion'

  const cycleUpdate = { status: cycleEnding ? 'completed' : 'active' }
  if (freshQuote.payoutType === 'early_partial') {
    cycleUpdate.partial_withdrawals = (cycle.partial_withdrawals || 0) + 1
  }
  if (cycleEnding) {
    cycleUpdate.paid_out_at = new Date().toISOString()
    // end_date is a GENERATED ALWAYS column (start_date + 30 days) —
    // Postgres computes it itself and rejects any manual write with
    // error 428C9. Writing to it here silently killed this ENTIRE
    // update (status + paid_out_at included), which is why completed
    // cycles were staying stuck on 'active' even after a real payout
    // succeeded. Confirmed against the live schema on 2026-08-23.
  }

  // CRITICAL: money has already moved (payoutFn succeeded) by this point.
  // These two writes are no longer optional bookkeeping — if either
  // fails, the database will disagree with reality (a completed payout
  // still shown pending, or a cycle still shown active after it should
  // have closed). Log loudly so this is never silent again; still return
  // success to the trader since the money genuinely did move, but this
  // now surfaces in logs for manual reconciliation instead of vanishing.
  const { error: cycleUpdateErr } = await supabaseAdmin
    .from('cycles')
    .update(cycleUpdate)
    .eq('id', cycle.id)

  if (cycleUpdateErr) {
    console.error(
      'processWithdrawal: PAYOUT SUCCEEDED but cycle update failed — needs manual reconciliation',
      { cycleId: cycle.id, payoutId: payout.id, cycleUpdate, error: cycleUpdateErr }
    )
    await sendAdminAlert(
      'Payout succeeded but cycle update failed',
      `A payout went through but the cycle record could not be updated.\n\nCycle ID: ${cycle.id}\nPayout ID: ${payout.id}\nIntended update: ${JSON.stringify(cycleUpdate)}\nSupabase error: ${cycleUpdateErr.message || JSON.stringify(cycleUpdateErr)}\n\nThis needs manual reconciliation in Supabase — check the cycles table for this ID.`
    )
  }

  const { error: payoutUpdateErr } = await supabaseAdmin
    .from('payouts')
    .update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      bank_reference: payoutResult.bankReference || null,
      commission_swept: !!payoutResult.commissionSwept,
    })
    .eq('id', payout.id)

  if (payoutUpdateErr) {
    console.error(
      'processWithdrawal: PAYOUT SUCCEEDED but payout status update failed — needs manual reconciliation',
      { payoutId: payout.id, error: payoutUpdateErr }
    )
    await sendAdminAlert(
      'Payout succeeded but payout status update failed',
      `A payout went through but its own record could not be marked completed.\n\nPayout ID: ${payout.id}\nCycle ID: ${cycle.id}\nBank reference: ${payoutResult.bankReference || 'none'}\nSupabase error: ${payoutUpdateErr.message || JSON.stringify(payoutUpdateErr)}\n\nThis needs manual reconciliation in Supabase — check the payouts table for this ID, it likely still shows 'pending' even though the money moved.`
    )
  }

  return {
    success: true,
    netAmount: freshQuote.netAmount,
    fee: freshQuote.fee,
    bankChangeFee,
    cycleEnded: cycleEnding,
  }
}

/**
 * DAY-30 CLOSE WHEN THERE IS NOTHING LEFT TO PAY OUT.
 *
 * Normally the commission is collected inside processWithdrawal, together
 * with the trader's final payout. But if the trader has already withdrawn
 * everything they were allowed to, or never saved more than the commission,
 * there is nothing to pay out and processWithdrawal cannot run (it refuses a
 * N0 payout). This covers that case: it moves the commission to MyAjo (or
 * whatever was saved, if that is less than the commission) and closes the
 * cycle.
 *
 * Safe to call repeatedly: it does nothing before day 30, never touches a
 * cycle that is not active, never collects twice, and if it cannot be sure
 * an earlier attempt finished it stops and raises an alert instead of
 * risking a double charge.
 *
 * sweepFn: ({ userId, amount }) => { success, commissionSwept, bankReference?, reason? }
 */
export async function collectRemainingCommission(cycleId, sweepFn) {
  const { data: cycle, error: cycleErr } = await supabaseAdmin
    .from('cycles')
    .select('*')
    .eq('id', cycleId)
    .single()

  if (cycleErr || !cycle) {
    return { success: false, reason: 'Could not load this cycle.' }
  }
  if (cycle.status !== 'active') {
    return { success: false, reason: 'This cycle is already closed.' }
  }
  if (!isCycleComplete(getCycleDayNumber(cycle.start_date))) {
    return { success: false, reason: 'This cycle has not reached day 30 yet.' }
  }

  const { data: payouts, error: payoutsErr } = await supabaseAdmin
    .from('payouts')
    .select('id, gross_amount, commission, commission_swept, status, payout_type')
    .eq('cycle_id', cycle.id)

  if (payoutsErr) {
    console.error('collectRemainingCommission: could not load payouts', cycle.id, payoutsErr)
    return { success: false, reason: 'Could not check earlier payouts for this cycle.' }
  }

  const history = payouts || []

  // An earlier collection that started but never finished recording. We
  // cannot tell whether the money moved, so we do not try again by ourselves.
  const unfinished = history.find(
    (p) => p.payout_type === 'commission_collection' && p.status === 'pending'
  )
  if (unfinished) {
    await sendAdminAlert(
      'Commission collection needs a manual check',
      `An earlier attempt to collect the commission for this cycle started but was never marked finished, so it was NOT repeated (to avoid taking it twice).\n\nCycle ID: ${cycle.id}\nPayout ID: ${unfinished.id}\n\nCheck in Anchor whether the commission transfer went through. If it did, mark that payout completed with commission_swept = true and set the cycle to completed. If it did not, delete that payout row and the next daily run will try again.`
    )
    return { success: false, reason: 'An earlier commission collection needs a manual check.' }
  }

  const alreadyWithdrawn = history
    .filter((p) => p.status === 'completed')
    .reduce((sum, p) => sum + parseFloat(p.gross_amount || 0), 0)
  const alreadyCollected = history.some(
    (p) => p.commission_swept === true && parseFloat(p.commission || 0) > 0
  )

  const totalSaved = parseFloat(cycle.total_saved || 0)
  const commission = parseFloat(cycle.commission || 0)
  const available = Math.max(totalSaved - alreadyWithdrawn, 0)
  const toCollect = alreadyCollected ? 0 : Math.min(commission, available)

  async function closeCycle(status) {
    const { error: closeErr } = await supabaseAdmin
      .from('cycles')
      .update({ status, paid_out_at: new Date().toISOString() })
      .eq('id', cycle.id)
    if (closeErr) {
      console.error('collectRemainingCommission: could not close cycle', cycle.id, closeErr)
      await sendAdminAlert(
        'Cycle could not be closed after day-30 handling',
        `Cycle ID: ${cycle.id}\nIntended status: ${status}\nSupabase error: ${closeErr.message || JSON.stringify(closeErr)}\n\nThe commission step is already recorded, so the next daily run will close it without collecting anything again. If it keeps happening, set the status by hand.`
      )
      return false
    }
    return true
  }

  // The commission was already collected earlier (for example by a payout
  // attempt that moved it and then failed). Just close the cycle.
  if (alreadyCollected) {
    const closed = await closeCycle('completed')
    return { success: true, collected: 0, alreadyCollected: true, closed }
  }

  // Nothing was ever saved, so there is nothing to collect.
  if (toCollect <= 0) {
    const closed = await closeCycle('abandoned')
    return { success: true, collected: 0, nothingSaved: true, closed }
  }

  const { data: row, error: insertErr } = await supabaseAdmin
    .from('payouts')
    .insert([{
      cycle_id: cycle.id,
      user_id: cycle.user_id,
      gross_amount: 0,
      commission: toCollect,
      net_amount: 0,
      payout_type: 'commission_collection',
      withdrawal_fee: 0,
      bank_change_fee: 0,
      fee_reason: 'Commission collected at the end of the cycle. Nothing was left to pay out.',
      status: 'pending',
      initiated_at: new Date().toISOString(),
    }])
    .select()
    .single()

  if (insertErr || !row) {
    console.error('collectRemainingCommission: could not log the collection', cycle.id, insertErr)
    return { success: false, reason: 'Could not log the commission collection.' }
  }

  let sweep
  try {
    sweep = await sweepFn({ userId: cycle.user_id, amount: toCollect })
  } catch (err) {
    // We do not know whether the money moved. Leave the row pending so the
    // next run stops and alerts instead of risking a second transfer.
    console.error('collectRemainingCommission: sweep threw', cycle.id, err)
    await sendAdminAlert(
      'Commission transfer threw an error',
      `Cycle ID: ${cycle.id}\nPayout ID: ${row.id}\nAmount: N${toCollect}\nError: ${err?.message || String(err)}\n\nWe cannot tell whether the money moved. Check in Anchor, then follow the steps in the "Commission collection needs a manual check" alert you will get tomorrow.`
    )
    return { success: false, reason: 'The commission transfer could not be confirmed.' }
  }

  if (!sweep?.success) {
    const { error: failErr } = await supabaseAdmin
      .from('payouts')
      .update({
        status: 'failed',
        failed_reason: sweep?.reason || 'Unknown error',
        commission_swept: !!sweep?.commissionSwept,
      })
      .eq('id', row.id)
    if (failErr) {
      console.error('collectRemainingCommission: could not mark the collection failed', row.id, failErr)
    }
    return { success: false, reason: sweep?.reason || 'The commission could not be collected.' }
  }

  const { error: doneErr } = await supabaseAdmin
    .from('payouts')
    .update({
      status: 'completed',
 completed_at: new Date().toISOString(),
      bank_reference: sweep.bankReference || null,
      commission_swept: true,
    })
    .eq('id', row.id)
 
  if (doneErr) {
    console.error('collectRemainingCommission: COMMISSION MOVED but record not updated', row.id, doneErr)
    await sendAdminAlert(
      'Commission moved but could not be recorded',
      `The commission for this cycle was moved to MyAjo, but its record could not be marked completed.\n\nPayout ID: ${row.id}\nCycle ID: ${cycle.id}\nAmount: N${toCollect}\nSupabase error: ${doneErr.message || JSON.stringify(doneErr)}\n\nMark that payout completed with commission_swept = true. Until then the next daily run will stop and alert instead of collecting again.`
    )
  }
 
  const closed = await closeCycle('completed')
  return { success: true, collected: toCollect, closed }
}
 
/**
 * Stub payout — logs instead of moving real money. Swap for Anchor's
 * disbursement/NIP transfer API once sandbox access is live. Keep the
 * same { userId, amount } -> { success, bankReference } shape so nothing
 * else needs to change on integration day.
 */
export async function stubPayout({ userId, amount }) {
  console.log(`[STUB PAYOUT] Would send N${amount} to user ${userId} via Anchor.`)
  return { success: true, bankReference: `STUB-${Date.now()}` }
}
