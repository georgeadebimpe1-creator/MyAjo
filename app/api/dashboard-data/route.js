import { NextResponse } from 'next/server'
import { supabaseAdmin } from '../../lib/supabase'
import { getCycleDayNumber } from '../../lib/savings'

// Always fetch fresh numbers, never a saved copy.
export const dynamic = 'force-dynamic'

// This route runs on the server and uses the admin database connection, so
// it can read the tables even though RLS is switched on. It sits behind the
// login check in middleware.js, so only a logged-in organiser can reach it.
export async function GET() {
  if (!supabaseAdmin) {
    console.error('dashboard-data: SUPABASE_SERVICE_ROLE_KEY is not set')
    return NextResponse.json({ error: 'Server is missing its database key' }, { status: 500 })
  }

  const { count: totalTraders, error: usersError } = await supabaseAdmin
    .from('users')
    .select('id', { count: 'exact', head: true })

  if (usersError) {
    console.error('dashboard-data: users count failed', usersError)
    return NextResponse.json({ error: 'Could not load traders' }, { status: 500 })
  }

  const { data: cyclesData, error: cyclesError } = await supabaseAdmin
    .from('cycles')
    .select('id, daily_amount, days_contributed, total_saved, commission, status, start_date, users(full_name, whatsapp_number)')
    .eq('status', 'active')
    .order('start_date', { ascending: false })

  if (cyclesError) {
    console.error('dashboard-data: cycles load failed', cyclesError)
    return NextResponse.json({ error: 'Could not load cycles' }, { status: 500 })
  }

  // Same calendar-day logic the bot uses (see getCycleDayNumber and the
  // cycle summary in app/lib/savings.js): the day number follows the
  // calendar, and missed days only shrink the payout, they never extend
  // the cycle.
  const cycles = (cyclesData || []).map((c) => {
    const dailyAmount = parseFloat(c.daily_amount) || 0
    const totalSaved = parseFloat(c.total_saved) || 0
    const commission = parseFloat(c.commission) || 0

    const cycleDayNumber = Math.min(Math.max(getCycleDayNumber(c.start_date), 1), 30)
    const daysRemaining = Math.max(30 - cycleDayNumber, 0)
    const expectedPayout = totalSaved + daysRemaining * dailyAmount - commission

    return {
      id: c.id,
      fullName: c.users?.full_name || null,
      whatsappNumber: c.users?.whatsapp_number || null,
      dailyAmount,
      startDate: c.start_date,
      daysContributed: c.days_contributed || 0,
      cycleDayNumber,
      totalSaved,
      commission,
      expectedPayout,
    }
  })

  const stats = {
    totalTraders: totalTraders || 0,
    activeCycles: cycles.length,
    totalSaved: cycles.reduce((sum, c) => sum + c.totalSaved, 0),
    commissionOnActiveCycles: cycles.reduce((sum, c) => sum + c.commission, 0),
  }

  return NextResponse.json({ stats, cycles })
}
