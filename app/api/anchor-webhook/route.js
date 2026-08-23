import { NextResponse } from 'next/server'
import { supabaseAdmin } from '../../lib/supabase'
import { sendMessage } from '../../lib/whatsapp'
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

    // CONFIRMED with Anchor (2026 Slack thread): three events fire per
    // inbound transfer — nip.inbound.received, nip.inbound.settled, and
    // nip.inbound.completed. Only 'completed' means the money is truly,
    // finally the trader's — the other two can fire before funds are
    // actually settled. Acting on any of the earlier ones risks
    // crediting a trader's savings for money that hasn't cleared yet.
    if (payload.data?.type !== 'nip.inbound.completed') {
      return new NextResponse('OK', { status: 200 })
    }

    // Each trader has their own individual DepositAccount (confirmed
    // architecture, not a shared/pooled one) — so this IS the correct
    // per-trader identifier to match against anchor_account_id.
    const anchorAccountId = payload.data?.relationships?.account?.data?.id

    // The amount is NOT on payload.data directly — it's on the included
    // InboundNIPTransfer resource. Anchor's docs confirm amounts are in
    // kobo (the smallest currency unit) for the transfer-creation API;
    // treating inbound event amounts the same way until proven otherwise
    // in a real sandbox test.
    const transferResource = (payload.included || []).find(r => r.type === 'InboundNIPTransfer')
    const amount = transferResource?.attributes?.amount
    const amountNaira = amount ? amount / 100 : null

    if (!anchorAccountId || !amountNaira) {
      console.error('Anchor webhook: missing account or amount', JSON.stringify(payload))
      return new NextResponse('OK', { status: 200 })
    }

    const { data: user, error: userErr } = await supabaseAdmin
      .from('users')
      .select('id, full_name, whatsapp_number')
      .eq('anchor_account_id', anchorAccountId)
      .single()

    if (userErr || !user) {
      console.error('Anchor webhook: no user found for account', anchorAccountId, userErr)
      return new NextResponse('OK', { status: 200 })
    }

    const { data: cycle, error: cycleErr } = await supabaseAdmin
      .from('cycles')
      .select('id, daily_amount, days_contributed, total_saved, commission, bank_name')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .single()

    if (cycleErr || !cycle) {
      console.error('Anchor webhook: no active cycle for user', user.id, cycleErr)
      return new NextResponse('OK', { status: 200 })
    }

    const today = new Date().toISOString().split('T')[0]

    // Same-day duplicate guard — without this, a retried or repeated
    // Anchor webhook event could record the same deposit twice and
    // inflate the trader's savings total.
    const { data: alreadyPaid } = await supabaseAdmin
      .from('contributions')
      .select('id')
      .eq('cycle_id', cycle.id)
      .eq('contribution_date', today)
      .single()

    if (alreadyPaid) {
      console.log('Anchor webhook: contribution already recorded today for user', user.id)
      return new NextResponse('OK', { status: 200 })
    }

    const { error: insertErr } = await supabaseAdmin.from('contributions').insert([{
      cycle_id: cycle.id,
      user_id: user.id,
      amount: amountNaira,
      contribution_date: today,
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
    const daysRemaining = 30 - newDays

    const { error: cycleUpdateErr } = await supabaseAdmin
      .from('cycles')
      .update({ days_contributed: newDays, total_saved: newTotal })
      .eq('id', cycle.id)

    if (cycleUpdateErr) {
      console.error('Anchor webhook: contribution recorded but cycle update failed — needs manual reconciliation', { cycleId: cycle.id, newDays, newTotal, error: cycleUpdateErr })
    }

    // Day 30 — cycle complete, trigger payout automatically.
    if (newDays === 30) {
      const updatedCycle = { ...cycle, days_contributed: newDays, total_saved: newTotal }
      const withdrawableBalance = await getWithdrawableBalance(updatedCycle)
      const result = await processWithdrawal(cycle.id, withdrawableBalance, anchorPayout)

      if (result.success) {
        // Leave the trader in 'cycle_complete' so a follow-up YES (which
        // the message below explicitly asks for) is actually handled by
        // route.js, instead of falling through to "I did not understand".
        await updateSession(user.whatsapp_number, 'cycle_complete', {})
      }

      const message = result.success
        ? getMessage('cycle_complete', 'en', {
            totalSaved: newTotal.toLocaleString(),
            commission: commission.toLocaleString(),
            netPayout: result.netAmount.toLocaleString(),
          })
        : `Congratulations ${user.full_name}!\n\nYou have completed your 30 day savings plan, but your payout could not be processed automatically (${result.reason}).\n\nPlease contact support at hello@myajo.com.ng and we will resolve this right away.`

      await sendMessage(user.whatsapp_number, message)
      return new NextResponse('OK', { status: 200 })
    }

    // Regular day — send the compact confirmation.
    const message = getMessage('contribution_recorded', 'en', {
      amount: amountNaira.toLocaleString(),
      dayNumber: newDays,
      totalSaved: newTotal.toLocaleString(),
      daysRemaining,
    })

    await sendMessage(user.whatsapp_number, message)
    return new NextResponse('OK', { status: 200 })
  } catch (error) {
    console.error('Anchor webhook error:', error)
    return new NextResponse('Error', { status: 500 })
  }
}
