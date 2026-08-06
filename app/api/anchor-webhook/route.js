import { NextResponse } from 'next/server'
import { supabase } from '../../lib/supabase'
import { sendMessage } from '../../lib/whatsapp'
import { getMessage } from '../../lib/messages'
import { getWithdrawableBalance, processWithdrawal, stubPayout } from '../../lib/withdrawal'

export async function POST(request) {
  try {
    const payload = await request.json()

    if (payload.data?.type !== 'payin.received') {
      return new NextResponse('OK', { status: 200 })
    }

    const anchorAccountId = payload.data?.relationships?.account?.data?.id
    const amount = payload.data?.attributes?.amount
    const amountNaira = amount ? amount / 100 : null

    if (!anchorAccountId || !amountNaira) {
      console.error('Anchor webhook: missing account or amount', JSON.stringify(payload))
      return new NextResponse('OK', { status: 200 })
    }

    const { data: user } = await supabase
      .from('users')
      .select('id, full_name, whatsapp_number')
      .eq('anchor_account_id', anchorAccountId)
      .single()

    if (!user) {
      console.error('Anchor webhook: no user found for account', anchorAccountId)
      return new NextResponse('OK', { status: 200 })
    }

    const { data: cycle } = await supabase
      .from('cycles')
      .select('id, daily_amount, days_contributed, total_saved, commission, bank_name')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .single()

    if (!cycle) {
      console.error('Anchor webhook: no active cycle for user', user.id)
      return new NextResponse('OK', { status: 200 })
    }

    const today = new Date().toISOString().split('T')[0]

    // Same-day duplicate guard — without this, a retried or repeated
    // Anchor webhook event could record the same deposit twice and
    // inflate the trader's savings total.
    const { data: alreadyPaid } = await supabase
      .from('contributions')
      .select('id')
      .eq('cycle_id', cycle.id)
      .eq('contribution_date', today)
      .single()

    if (alreadyPaid) {
      console.log('Anchor webhook: contribution already recorded today for user', user.id)
      return new NextResponse('OK', { status: 200 })
    }

    await supabase.from('contributions').insert([{
      cycle_id: cycle.id,
      user_id: user.id,
      amount: amountNaira,
      contribution_date: today,
      verified: true,
      contribution_type: 'daily',
    }])

    const newDays = cycle.days_contributed + 1
    const newTotal = parseFloat(cycle.total_saved) + amountNaira
    const commission = parseFloat(cycle.commission)
    const daysRemaining = 30 - newDays

    await supabase
      .from('cycles')
      .update({ days_contributed: newDays, total_saved: newTotal })
      .eq('id', cycle.id)

    // Day 30 — cycle complete, trigger payout automatically.
    if (newDays === 30) {
      const updatedCycle = { ...cycle, days_contributed: newDays, total_saved: newTotal }
      const withdrawableBalance = await getWithdrawableBalance(updatedCycle)
      const result = await processWithdrawal(cycle.id, withdrawableBalance, stubPayout)

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
