import { NextResponse } from 'next/server'
import { supabaseAdmin } from '../../lib/supabase'
import { sendMessage } from '../../lib/whatsapp'
import { getMessage } from '../../lib/messages'
import { getWithdrawableBalance, processWithdrawal } from '../../lib/withdrawal'
import { anchorPayout } from '../../lib/payout'
import { updateSession } from '../../lib/session'

export async function POST(request) {
  try {
    const payload = await request.json()

    if (!supabaseAdmin) {
      console.error('Anchor webhook: SUPABASE_SERVICE_ROLE_KEY is not set, cannot write to database')
      return new NextResponse('Server misconfigured', { status: 500 })
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
