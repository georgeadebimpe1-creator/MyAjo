import { NextResponse } from 'next/server'
import { supabase } from '../../lib/supabase'
import { sendMessage } from '../../lib/whatsapp'
import { getMessage } from '../../lib/messages'

// Vercel Cron calls this once a day with an Authorization header
// matching CRON_SECRET. Anyone else calling this URL without that
// header gets rejected — otherwise a stranger could spam every trader.
export async function GET(request) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const today = new Date().toISOString().split('T')[0]

  const { data: cycles, error } = await supabase
    .from('cycles')
    .select('id, daily_amount, days_contributed, user_id, users(whatsapp_number)')
    .eq('status', 'active')

  if (error) {
    console.error('Daily reminder: could not fetch active cycles', error)
    return new NextResponse('Error', { status: 500 })
  }

  let sent = 0
  let skipped = 0

  for (const cycle of cycles || []) {
    const { data: paidToday } = await supabase
      .from('contributions')
      .select('id')
      .eq('cycle_id', cycle.id)
      .eq('contribution_date', today)
      .single()

    if (paidToday) {
      skipped++
      continue
    }

    if (!cycle.users?.whatsapp_number) {
      console.error('Daily reminder: cycle missing whatsapp number', cycle.id)
      continue
    }

    const message = getMessage('daily_reminder', 'en', {
      dailyAmount: parseFloat(cycle.daily_amount).toLocaleString(),
      streakDays: cycle.days_contributed,
    })

    await sendMessage(cycle.users.whatsapp_number, message)
    sent++
  }

  return NextResponse.json({ ok: true, sent, skipped })
}
