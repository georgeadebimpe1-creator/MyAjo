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
import { quoteWithdrawal } from './withdrawalLogic'

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
  const withdrawableBalance = await getWithdrawableBalance(cycle)
  return quoteWithdrawal({
    requestedAmount,
    daysContributed: cycle.days_contributed,
    withdrawableBalance,
  })
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

  const withdrawableBalance = await getWithdrawableBalance(cycle)
  const freshQuote = quoteWithdrawal({
    requestedAmount,
    daysContributed: cycle.days_contributed,
    withdrawableBalance,
  })

  if (!freshQuote.allowed) {
    return { success: false, reason: freshQuote.reason }
  }

  const { data: payout, error: insertErr } = await supabaseAdmin
    .from('payouts')
    .insert([{
      cycle_id: cycle.id,
      user_id: cycle.user_id,
      gross_amount: freshQuote.requestedAmount,
      commission: freshQuote.payoutType === 'cycle_completion' ? cycle.commission : 0,
      net_amount: freshQuote.netAmount,
      payout_type: freshQuote.payoutType,
      withdrawal_fee: freshQuote.fee,
      fee_reason: freshQuote.feeReason,
      status: 'pending',
      initiated_at: new Date().toISOString(),
    }])
    .select()
    .single()

  if (insertErr) {
    return { success: false, reason: 'Could not log this withdrawal. Please try again.' }
  }

  const payoutResult = await payoutFn({ userId: cycle.user_id, amount: freshQuote.netAmount })

  if (!payoutResult.success) {
    const { error: failUpdateErr } = await supabaseAdmin
      .from('payouts')
      .update({ status: 'failed', failed_reason: payoutResult.reason || 'Unknown error' })
      .eq('id', payout.id)

    if (failUpdateErr) {
      console.error('processWithdrawal: could not mark payout failed', payout.id, failUpdateErr)
    }
    return { success: false, reason: 'The payout could not be completed. Please try again shortly, or contact support.' }
  }

  const cycleEnding =
    freshQuote.payoutType === 'early_full' ||
    freshQuote.payoutType === 'cycle_completion' ||
    withdrawableBalance - freshQuote.requestedAmount <= 0

  const cycleUpdate = { status: cycleEnding ? 'completed' : 'active' }
  if (freshQuote.payoutType === 'early_partial') {
    cycleUpdate.partial_withdrawals = (cycle.partial_withdrawals || 0) + 1
  }
  if (cycleEnding) {
    cycleUpdate.paid_out_at = new Date().toISOString()
    cycleUpdate.end_date = new Date().toISOString().split('T')[0]
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
  }

  const { error: payoutUpdateErr } = await supabaseAdmin
    .from('payouts')
    .update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      bank_reference: payoutResult.bankReference || null,
    })
    .eq('id', payout.id)

  if (payoutUpdateErr) {
    console.error(
      'processWithdrawal: PAYOUT SUCCEEDED but payout status update failed — needs manual reconciliation',
      { payoutId: payout.id, error: payoutUpdateErr }
    )
  }

  return {
    success: true,
    netAmount: freshQuote.netAmount,
    fee: freshQuote.fee,
    cycleEnded: cycleEnding,
  }
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
