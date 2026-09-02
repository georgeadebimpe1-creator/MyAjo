import { NextResponse } from 'next/server'
import { supabaseAdmin } from '../../lib/supabase'
import { sendMessage, sendProactiveMessage } from '../../lib/whatsapp'
import { getMessage } from '../../lib/messages'
import { getWithdrawableBalance, processWithdrawal } from '../../lib/withdrawal'
import { anchorPayout } from '../../lib/payout'
import { getSession, updateSession, clearSession } from '../../lib/session'
import { finalizeAnchorDepositAccount } from '../../lib/accounts'
import { startCycle, getActiveCycle } from '../../lib/savings'

// Handles the three possible outcomes of the KYC verification triggered
// during onboarding by provisionAnchorAccount(). Only 'approved' is
// allowed to create the deposit account — see the "Customer does not
// have kyc verification" error this whole flow exists to avoid.
async function handleKycEvent(payload) {
  const eventType = payload.data.type
  const anchorCustomerId = payload.data?.relationships?.customer?.data?.id

  if (!anchorCustomerId) {
    console.error('Anchor KYC webhook: missing customer id', JSON.stringify(payload))
    return new NextResponse('OK', { status: 200 })
  }

  const { data: user, error: userErr } = await supabaseAdmin
    .from('users')
    .select('id, full_name, whatsapp_number')
    .eq('anchor_customer_id', anchorCustomerId)
    .single()

  if (userErr || !user) {
    console.error('Anchor KYC webhook: no user found for customer', anchorCustomerId, userErr)
    return new NextResponse('OK', { status: 200 })
  }

  if (eventType === 'customer.identification.error') {
    // Anchor says: retry the verification later, this wasn't a hard no.
    await supabaseAdmin.from('users').update({ anchor_kyc_status: null }).eq('id', user.id)
    await sendMessage(
      user.whatsapp_number,
      `We hit a temporary issue verifying your details with our banking partner. Please type CONFIRM again in a moment to retry.`
    )
    return new NextResponse('OK', { status: 200 })
  }

  if (eventType === 'customer.identification.rejected') {
    await supabaseAdmin.from('users').update({ anchor_kyc_status: 'rejected' }).eq('id', user.id)
    await clearSession(user.whatsapp_number)
    await sendMessage(
      user.whatsapp_number,
      `We could not verify your details with our banking partner. This usually happens if your name, phone number, or BVN details don't match. Please contact support at hello@myajo.com.ng and we will help sort this out.`
    )
    return new NextResponse('OK', { status: 200 })
  }

  // approved — safe to actually create the deposit account now.
  let account
  try {
    account = await finalizeAnchorDepositAccount(user.id)
  } catch (err) {
    console.error('Anchor KYC webhook: finalizeAnchorDepositAccount failed', user.id, err)
    await sendMessage(
      user.whatsapp_number,
      `Your verification was approved, but we hit an error setting up your account. Please contact support at hello@myajo.com.ng.`
    )
    return new NextResponse('OK', { status: 200 })
  }

  // Pick up the daily_amount that route.js stashed in session when it
  // sent the trader into the "waiting on verification" state. Without
  // this, the savings cycle never actually gets created even though the
  // account now exists.
  const session = await getSession(user.whatsapp_number)
  const dailyAmount = session?.step === 'awaiting_kyc_approval' ? session.temp_data?.daily_amount : null

  if (dailyAmount) {
    await startCycle(user.id, dailyAmount)
    await clearSession(user.whatsapp_number)
    await sendMessage(
      user.whatsapp_number,
      `Your savings plan is now active!\n\n${user.full_name} your MyAjo journey has begun.\n\nSend your daily savings of N${parseFloat(dailyAmount).toLocaleString()} to this account:\n\nAccount Number: ${account.accountNumber}\n(This is your dedicated MyAjo savings account, held with our licensed banking partner.)\n\nWhen your transfer goes through, we will confirm it automatically. You can also type PAID anytime to check.\n\nGood luck and stay consistent!`
    )
  } else {
    // Session is gone — most likely because the trader's own poll
    // (checkAndFinalizeIfApproved, triggered when they re-interacted
    // with Temi) already finished this exact job before this webhook
    // arrived. finalizeAnchorDepositAccount() above is idempotent, so
    // that's harmless — but check for an active cycle before messaging,
    // so we don't send a confusing duplicate on top of what polling
    // already told them.
    const alreadyHandled = await getActiveCycle(user.id)
    if (alreadyHandled) {
      return new NextResponse('OK', { status: 200 })
    }

    console.error('Anchor KYC webhook: approved but no pending daily_amount in session', user.id)
    await sendMessage(
      user.whatsapp_number,
      `Good news ${user.full_name} — your account with our banking partner is now verified. Please type MENU and choose "Start Daily Savings" to finish setting up your plan.`
    )
  }

  return new NextResponse('OK', { status: 200 })
}

export async function POST(request) {
  try {
    const payload = await request.json()

    // Logs the event type on every single incoming call, before any
    // filtering below — added because the filters further down (only
    // acting on nip.inbound.completed, only known KYC event types)
    // silently drop anything else with zero logging. That's correct
    // caution for production, but it means we currently have no way to
    // see what Anchor's sandbox "Simulate Transfer" feature actually
    // sends. This line is the fix for that blind spot.
    console.log('Anchor webhook received:', payload.data?.type, JSON.stringify(payload))

    if (!supabaseAdmin) {
      console.error('Anchor webhook: SUPABASE_SERVICE_ROLE_KEY is not set, cannot write to database')
      return new NextResponse('Server misconfigured', { status: 500 })
    }

    // KYC verification result — arrives async, sometime after
    // provisionAnchorAccount() triggered it during onboarding. This is
    // a completely separate flow from the deposit/contribution logic
    // below, so it's handled and returned here before anything else.
    // NOT YET CONFIRMED against a real sandbox payload — built from
    // Anchor's docs example, which shows type/relationships nested the
    // same way as every other event in this file (under `data`). If
    // this branch never fires during testing, log the raw payload once
    // and check whether Anchor actually sends it flatter than this.
    if (
      payload.data?.type === 'customer.identification.approved' ||
      payload.data?.type === 'customer.identification.error' ||
      payload.data?.type === 'customer.identification.rejected'
    ) {
      return await handleKycEvent(payload)
    }

    // CONFIRMED against a real sandbox payload (2026-08-23): the
    // previously assumed event names (nip.inbound.received/settled/
    // completed) do NOT match what Anchor actually sends. A real
    // Simulate Transfer produced three different events instead —
    // payment.received, transaction.created, payment.settled, in that
    // order. 'payment.settled' is the one that carries a final,
    // confirmed amount and the receiving account — acting on the
    // earlier 'payment.received' risks crediting a trader before the
    // transfer is actually finalized, same caution as before, just
    // against the real event name this time instead of a guessed one.
    if (payload.data?.type !== 'payment.settled') {
      return new NextResponse('OK', { status: 200 })
    }

    // Real payload shape, confirmed 2026-08-23 — completely different
    // from the previously assumed 'included' array with an
    // InboundNIPTransfer resource. Everything needed is nested directly
    // under attributes.payment instead.
    const payment = payload.data?.attributes?.payment
    const anchorAccountId = payment?.settlementAccount?.accountId
    const amountKobo = payment?.amount
    const amountNaira = amountKobo ? amountKobo / 100 : null

    if (!anchorAccountId || !amountNaira) {
      console.error('Anchor webhook: missing account or amount', JSON.stringify(payload))
      return new NextResponse('OK', { status: 200 })
    }

    const { data: user, error: userErr } = await supabaseAdmin
      .from('users')
      .select('id, full_name, whatsapp_number, last_inbound_at, language')
      .eq('anchor_account_id', anchorAccountId)
      .single()

    if (userErr || !user) {
      console.error('Anchor webhook: no user found for account', anchorAccountId, userErr)
      return new NextResponse('OK', { status: 200 })
    }

    // FIXED 2026-08-23: this select previously included 'bank_name',
    // which does not exist on the cycles table (Postgres error 42703 —
    // "column cycles.bank_name does not exist"). Because the malformed
    // select made the whole query error out, this always fell into the
    // "no active cycle" branch below even when a genuinely active cycle
    // existed — confirmed directly against the cycles table in Supabase,
    // which showed status: active the entire time this was failing.
    // bank_name lives on the users table, not cycles, and nothing in
    // this file reads cycle.bank_name, so it's just removed here.
    const { data: cycle, error: cycleErr } = await supabaseAdmin
      .from('cycles')
      .select('id, daily_amount, days_contributed, total_saved, commission, start_date')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .single()

    if (cycleErr || !cycle) {
      console.error('Anchor webhook: no active cycle for user', user.id, cycleErr)
      return new NextResponse('OK', { status: 200 })
    }

    const today = new Date().toISOString().split('T')[0]
    const paymentReference = payment?.paymentReference || null

    // FIXED 2026-08-23: this guard previously checked "any contribution
    // recorded today for this cycle" — which meant a trader making TWO
    // genuine deposits on the same day (e.g. their normal daily amount,
    // plus a separate top-up or catch-up payment) would have their
    // second payment silently dropped after money had already left
    // their account, with no record and no notification. Confirmed
    // directly: a second real ₦20,000 transfer was ignored because a
    // ₦2,000 contribution already existed for that date.
    //
    // Now keyed on Anchor's paymentReference instead, which is unique
    // per bank transfer. This still correctly skips a true duplicate
    // webhook delivery (Anchor retrying the same event), but no longer
    // blocks a second distinct real deposit on the same calendar day.
    if (!paymentReference) {
      // Extremely defensive — Anchor's payload always includes this in
      // practice, but if it's ever missing we can't safely dedupe, so
      // log loudly and manual reconciliation catches it via the
      // duplicate-contribution check that would otherwise apply.
      console.error('Anchor webhook: payment.settled event missing paymentReference — cannot dedupe safely', JSON.stringify(payload))
    } else {
      const { data: alreadyPaid } = await supabaseAdmin
        .from('contributions')
        .select('id')
        .eq('cycle_id', cycle.id)
        .eq('payment_reference', paymentReference)
        .single()

      if (alreadyPaid) {
        console.log('Anchor webhook: this exact payment was already recorded (duplicate webhook delivery)', { userId: user.id, paymentReference })
        return new NextResponse('OK', { status: 200 })
      }
    }

    // RULE (2026-08-23): only the exact daily_amount chosen at onboarding
    // is accepted — no top-ups. Compared in kobo to avoid float rounding
    // issues (e.g. 2000.0000001 !== 2000). A wrong amount is real money
    // that landed at Anchor, so it's flagged for manual reconciliation
    // and the trader is told directly, rather than silently dropped or
    // silently accepted at the wrong amount.
    const expectedKobo = Math.round(parseFloat(cycle.daily_amount) * 100)
    if (amountKobo !== expectedKobo) {
      console.error('Anchor webhook: payment amount does not match daily_amount — needs manual reconciliation', {
        userId: user.id,
        cycleId: cycle.id,
        expectedNaira: cycle.daily_amount,
        receivedNaira: amountNaira,
        paymentReference,
      })
      await sendMessage(
        user.whatsapp_number,
        `We received a transfer of N${amountNaira.toLocaleString()}, but your daily savings amount is N${parseFloat(cycle.daily_amount).toLocaleString()}. This payment has not been recorded yet — please contact support at hello@myajo.com.ng so we can sort this out for you.`
      )
      return new NextResponse('OK', { status: 200 })
    }

    // RULE (2026-08-23, calendar-day fix): missed-day catch-up. A trader
    // who misses a day may send a second correct-amount payment the next
    // day to cover it — but only one catch-up, and only for a genuinely
    // missed day, not as an extra top-up. Enforced as: at most 2
    // contributions per calendar day for a cycle, and a 2nd is only
    // allowed if yesterday has zero contributions recorded (proof a day
    // was actually missed).
    //
    // FIX: this used to just check "does yesterday have zero
    // contributions", with no concept of the cycle's own start date. On
    // a trader's very first day, yesterday trivially has zero
    // contributions too (the cycle didn't exist yet), so a second
    // same-day transfer would have been wrongly waved through as a
    // "missed-day catch-up" when there was no prior day in the cycle to
    // catch up for. cycleDayNumber (from cycle.start_date) now makes
    // that distinction explicit: day 1 has no day 0 to miss, so a repeat
    // payment on day 1 is always an unauthorized top-up, never a
    // catch-up, regardless of what "yesterday" on the calendar looks
    // like.
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0]

    const cycleStartDate = new Date(`${cycle.start_date}T00:00:00Z`)
    const todayDate = new Date(`${today}T00:00:00Z`)
    const cycleDayNumber = Math.floor((todayDate - cycleStartDate) / (24 * 60 * 60 * 1000)) + 1

    const { count: todayCount } = await supabaseAdmin
      .from('contributions')
      .select('id', { count: 'exact', head: true })
      .eq('cycle_id', cycle.id)
      .eq('contribution_date', today)

    if ((todayCount || 0) >= 2) {
      console.error('Anchor webhook: 3rd+ contribution attempt in one day rejected — needs manual reconciliation', { userId: user.id, cycleId: cycle.id, paymentReference })
      await sendMessage(
        user.whatsapp_number,
        `We received another transfer of N${amountNaira.toLocaleString()}, but today's savings (including a missed-day catch-up) are already fully recorded. This payment has not been recorded yet — please contact support at hello@myajo.com.ng.`
      )
      return new NextResponse('OK', { status: 200 })
    }

    if ((todayCount || 0) === 1) {
      if (cycleDayNumber <= 1) {
        // Day 1 of the cycle (or a clock/timezone edge case landing
        // before it) — there is no prior day in this cycle to have
        // missed, so a second payment today can only be a top-up.
        console.error('Anchor webhook: unauthorized top-up rejected — cycle day 1, no prior day exists to catch up for', { userId: user.id, cycleId: cycle.id, cycleDayNumber, paymentReference })
        await sendMessage(
          user.whatsapp_number,
          `We received another transfer of N${amountNaira.toLocaleString()}, but today's savings are already recorded and there is no missed day to make up for. This payment has not been recorded yet — please contact support at hello@myajo.com.ng.`
        )
        return new NextResponse('OK', { status: 200 })
      }

      const { count: yesterdayCount } = await supabaseAdmin
        .from('contributions')
        .select('id', { count: 'exact', head: true })
        .eq('cycle_id', cycle.id)
        .eq('contribution_date', yesterday)

      if ((yesterdayCount || 0) > 0) {
        console.error('Anchor webhook: unauthorized top-up rejected — yesterday already covered', { userId: user.id, cycleId: cycle.id, paymentReference })
        await sendMessage(
          user.whatsapp_number,
          `We received another transfer of N${amountNaira.toLocaleString()}, but today's savings are already recorded and there is no missed day to make up for. This payment has not been recorded yet — please contact support at hello@myajo.com.ng.`
        )
        return new NextResponse('OK', { status: 200 })
      }
      // else: yesterday has zero contributions and this cycle has been
      // running for more than one day — this is a legitimate catch-up
      // for a genuinely missed day, allow it through.
    }

    const { error: insertErr } = await supabaseAdmin.from('contributions').insert([{
      cycle_id: cycle.id,
      user_id: user.id,
      amount: amountNaira,
      contribution_date: today,
      payment_reference: paymentReference,
      verified: true,
      contribution_type: 'daily',
    }])

    if (insertErr) {
      // A real deposit landed at Anchor but we failed to record it —
      // this needs a human, not a silent drop. The trader will not get
      // a confirmation message as a result of this early return.
      console.error('Anchor webhook: MONEY RECEIVED but contribution insert failed — needs manual reconciliation', { userId: user.id, cycleId: cycle.id, amountNaira, error: insertErr })
      return new NextResponse('OK', { status: 200 })
    }

    const newDays = cycle.days_contributed + 1
    const newTotal = parseFloat(cycle.total_saved) + amountNaira
    const commission = parseFloat(cycle.commission)
    // Calendar-bound, not payment-bound: "days remaining" is how many
    // calendar days are left in the fixed 30-day cycle, capped at 0, not
    // 30 minus how many payments have landed. A trader who missed a day
    // is behind on savings, but the cycle still counts down on schedule.
    const daysRemaining = Math.max(30 - cycleDayNumber, 0)

    const { error: cycleUpdateErr } = await supabaseAdmin
      .from('cycles')
      .update({ days_contributed: newDays, total_saved: newTotal })
      .eq('id', cycle.id)

    if (cycleUpdateErr) {
      console.error('Anchor webhook: contribution recorded but cycle update failed — needs manual reconciliation', { cycleId: cycle.id, newDays, newTotal, error: cycleUpdateErr })
    }

    // Day 30 (calendar) — cycle complete, trigger payout automatically.
    // FIX: this used to check newDays === 30 (the 30th payment), which
    // meant a trader who missed days without catching up would just
    // keep the cycle open indefinitely until a 30th payment eventually
    // landed. Per the fixed-30-calendar-day decision, the cycle now
    // closes on calendar day 30 regardless of how many payments were
    // actually made — a trader who fell behind simply gets a smaller
    // payout, computed from whatever total_saved actually is.
    if (cycleDayNumber >= 30) {
      const updatedCycle = { ...cycle, days_contributed: newDays, total_saved: newTotal }
      const withdrawableBalance = await getWithdrawableBalance(updatedCycle)
      const result = await processWithdrawal(cycle.id, withdrawableBalance, anchorPayout)

      if (result.success) {
        // Leave the trader in 'cycle_complete' so a follow-up YES (which
        // the message below explicitly asks for) is actually handled by
        // route.js, instead of falling through to "I did not understand".
        await updateSession(user.whatsapp_number, 'cycle_complete', {})
      }

      const lang = user.language || 'en'

      if (result.success) {
        await sendProactiveMessage(user.whatsapp_number, {
          userId: user.id,
          lastInboundAt: user.last_inbound_at,
          messageType: 'cycle_complete',
          language: lang,
          textBody: getMessage('cycle_complete', lang, {
            totalSaved: newTotal.toLocaleString(),
            commission: commission.toLocaleString(),
            netPayout: result.netAmount.toLocaleString(),
          }),
          templateComponents: [{
            type: 'body',
            parameters: [
              { type: 'text', text: newTotal.toLocaleString() },
              { type: 'text', text: commission.toLocaleString() },
              { type: 'text', text: result.netAmount.toLocaleString() },
            ],
          }],
        })
      } else {
        // Rare failure path needing admin follow-up regardless — no
        // approved template registered for this one, so this stays a
        // direct text send. If the window happens to be closed here
        // too, it may not deliver; the underlying failure is already
        // logged above for manual reconciliation either way.
        await sendMessage(
          user.whatsapp_number,
          `Congratulations ${user.full_name}!\n\nYou have completed your 30 day savings plan, but your payout could not be processed automatically (${result.reason}).\n\nPlease contact support at hello@myajo.com.ng and we will resolve this right away.`,
          { messageType: 'cycle_complete_failed', userId: user.id }
        )
      }

      return new NextResponse('OK', { status: 200 })
    }

    // Regular day — send the compact confirmation. dayNumber is the
    // calendar day (cycleDayNumber), matching what BALANCE and the
    // day-30 completion trigger now use — not the payment count.
    const lang = user.language || 'en'

    await sendProactiveMessage(user.whatsapp_number, {
      userId: user.id,
      lastInboundAt: user.last_inbound_at,
      messageType: 'contribution_recorded',
      language: lang,
      textBody: getMessage('contribution_recorded', lang, {
        amount: amountNaira.toLocaleString(),
        dayNumber: cycleDayNumber,
        totalSaved: newTotal.toLocaleString(),
        daysRemaining,
      }),
      templateComponents: [{
        type: 'body',
        parameters: [
          { type: 'text', text: amountNaira.toLocaleString() },
          { type: 'text', text: String(cycleDayNumber) },
          { type: 'text', text: newTotal.toLocaleString() },
          { type: 'text', text: String(daysRemaining) },
        ],
      }],
    })
    return new NextResponse('OK', { status: 200 })
  } catch (error) {
    console.error('Anchor webhook error:', error)
    return new NextResponse('Error', { status: 500 })
  }
}
