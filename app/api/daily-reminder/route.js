import { NextResponse } from 'next/server'
import { supabase } from '../../lib/supabase'
import { sendMessage, sendProactiveMessage } from '../../lib/whatsapp'
import { getMessage } from '../../lib/messages'
import { getCycleDayNumber } from '../../lib/savings'
import { getWithdrawableBalance, processWithdrawal } from '../../lib/withdrawal'
import { anchorPayout } from '../../lib/payout'
import { sendAdminAlert } from '../../lib/alerts'

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
  let failed = 0
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
        const completeResult = await sendProactiveMessage(cycle.users.whatsapp_number, {
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

        // A real payout just went out — if the trader can't be told,
        // that's a support/trust problem waiting to happen (they'll see
        // money land with no explanation), worth a direct alert rather
        // than only the generic console.error the send path already logs.
        if (!completeResult?.ok) {
          console.error('Daily reminder: day-30 payout succeeded but notification failed', { cycleId: cycle.id, whatsapp: cycle.users.whatsapp_number })
          await sendAdminAlert(
            `Payout succeeded but trader could not be notified.\n\nCycle ID: ${cycle.id}\nWhatsApp: ${cycle.users.whatsapp_number}\nNet payout: N${result.netAmount.toLocaleString()}\n\nTheir money has been sent, but they don't know it yet — worth reaching out directly.`
          )
        }
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

    // MESSAGE-REDUCTION (2026-09-14): don't nudge on the very first missed
    // day — give traders a pass for a single slip rather than messaging
    // (and billing) every single day. From the 2nd consecutive missed day
    // onward, reminders resume daily until they catch up, so someone who
    // drifts further doesn't go completely silent. Day 1 of a cycle has no
    // prior day to have "caught up" from, so it's never skipped — a
    // brand-new trader who hasn't paid yet on day 1 still gets reminded.
    if (cycleDayNumber > 1) {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0]
      const { data: paidYesterday } = await supabase
        .from('contributions')
        .select('id')
        .eq('cycle_id', cycle.id)
        .eq('contribution_date', yesterday)
        .single()

      if (paidYesterday) {
        skipped++
        continue
      }
    }

    if (!cycle.users?.whatsapp_number) {
      console.error('Daily reminder: cycle missing whatsapp number', cycle.id)
      continue
    }

    const reminderResult = await sendProactiveMessage(cycle.users.whatsapp_number, {
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

    // FIXED 2026-09-08: this used to increment `sent` unconditionally
    // right after the await, regardless of whether Meta actually
    // accepted the message. That's exactly how the template
    // language-code bug (see whatsapp.js) went unnoticed for 5 days —
    // this endpoint kept reporting "sent: 2" every single day while
    // every one of those sends was actually failing. `sent` now only
    // counts confirmed successes; `failed` makes real delivery problems
    // visible in the response itself instead of requiring someone to
    // separately check Vercel's error logs to notice.
    if (reminderResult?.ok) {
      sent++
    } else {
      failed++
      console.error('Daily reminder: send failed for', cycle.users.whatsapp_number, 'cycle', cycle.id)
    }
  }

  return NextResponse.json({ ok: true, sent, failed, skipped, closed })
}
