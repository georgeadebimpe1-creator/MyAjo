import { NextResponse } from 'next/server'
import { supabase } from '../../lib/supabase'
import { sendMessage, sendProactiveMessage } from '../../lib/whatsapp'
import { getMessage } from '../../lib/messages'
import { getCycleDayNumber } from '../../lib/savings'
import { getWithdrawableBalance, processWithdrawal } from '../../lib/withdrawal'
import { anchorPayout } from '../../lib/payout'

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
    .select('id, daily_amount, days_contributed, total_saved, commission, start_date, user_id, users(full_name, whatsapp_number, last_inbound_at, language)')
    .eq('status', 'active')

  if (error) {
    console.error('Daily reminder: could not fetch active cycles', error)
    return new NextResponse('Error', { status: 500 })
  }

  let sent = 0
  let skipped = 0
  let closed = 0

  for (const cycle of cycles || []) {
    // FIXED 30-CALENDAR-DAY CYCLE: the webhook closes a cycle the moment
    // a payment lands on calendar day 30, but if a trader simply stops
    // paying before day 30, no webhook ever fires to close it. This is
    // the sweep for that case — anything still 'active' once its own
    // calendar day 30 has arrived gets closed here, with whatever total
    // was actually saved. Runs once a day, same schedule as reminders,
    // so a cycle closes on the day it's due at the latest.
    const cycleDayNumber = getCycleDayNumber(cycle.start_date)
    const lang = cycle.users?.language || 'en'

    if (cycleDayNumber >= 30) {
      if (!cycle.users?.whatsapp_number) {
        console.error('Daily reminder: overdue cycle missing whatsapp number, cannot notify', cycle.id)
      }

      const withdrawableBalance = await getWithdrawableBalance(cycle)
      const result = await processWithdrawal(cycle.id, withdrawableBalance, anchorPayout)

      if (result.success && cycle.users?.whatsapp_number) {
        await sendProactiveMessage(cycle.users.whatsapp_number, {
          userId: cycle.user_id,
          lastInboundAt: cycle.users.last_inbound_at,
          messageType: 'cycle_complete',
          language: lang,
          textBody: getMessage('cycle_complete', lang, {
            totalSaved: parseFloat(cycle.total_saved).toLocaleString(),
            commission: parseFloat(cycle.commission).toLocaleString(),
            netPayout: result.netAmount.toLocaleString(),
          }),
          templateComponents: [{
            type: 'body',
            parameters: [
              { type: 'text', text: parseFloat(cycle.total_saved).toLocaleString() },
              { type: 'text', text: parseFloat(cycle.commission).toLocaleString() },
              { type: 'text', text: result.netAmount.toLocaleString() },
            ],
          }],
        })
      } else if (!result.success) {
        console.error('Daily reminder: day-30 auto-close failed, needs manual reconciliation', { cycleId: cycle.id, reason: result.reason })
      }

      closed++
      continue
    }

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

    await sendProactiveMessage(cycle.users.whatsapp_number, {
      userId: cycle.user_id,
      lastInboundAt: cycle.users.last_inbound_at,
      messageType: 'daily_reminder',
      language: lang,
      textBody: getMessage('daily_reminder', lang, {
        dailyAmount: parseFloat(cycle.daily_amount).toLocaleString(),
        streakDays: cycle.days_contributed,
      }),
      templateComponents: [{
        type: 'body',
        parameters: [
          { type: 'text', text: parseFloat(cycle.daily_amount).toLocaleString() },
          { type: 'text', text: String(cycle.days_contributed) },
        ],
      }],
    })
    sent++
  }

  return NextResponse.json({ ok: true, sent, skipped, closed })

  ]
