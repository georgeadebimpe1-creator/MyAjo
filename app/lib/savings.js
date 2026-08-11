// app/lib/savings.js
//
// The savings-cycle math and lookups that used to live inline inside
// the BALANCE, PAID, and onboarding steps of route.js. Pulling these
// out means the commission calculation exists in exactly one place —
// previously the same formula was repeated in three separate spots in
// route.js, which is how those spots quietly drift out of sync.
//
// Behavior is unchanged from the original inline code.

import { supabase } from './supabase'

export const COMMISSION_RATE = 0.03

export function calculateCommission(totalSavings) {
  return Math.round(totalSavings * COMMISSION_RATE)
}

// Used at the "how much per day" onboarding step, before a cycle exists,
// to show the trader what their 30-day plan will look like.
export function projectPlan(dailyAmount) {
  const totalSavings = dailyAmount * 30
  const commission = calculateCommission(totalSavings)
  const payout = totalSavings - commission
  return { totalSavings, commission, payout }
}

export async function getActiveCycle(userId) {
  const { data } = await supabase
    .from('cycles')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'active')
    .single()

  return data
}

export async function startCycle(userId, dailyAmount) {
  const totalSavings = dailyAmount * 30
  const commission = calculateCommission(totalSavings)

  const { data: cycle } = await supabase
    .from('cycles')
    .insert([{
      user_id: userId,
      daily_amount: dailyAmount,
      commission: commission,
      status: 'active',
      start_date: new Date().toISOString().split('T')[0],
    }])
    .select()
    .single()

  return cycle
}

// The numbers behind the BALANCE message — saved amount, days done,
// progress bar, expected payout. Returns plain data; formatting into
// WhatsApp text (or any other channel's format) happens where it's
// displayed, not here.
export function getBalanceSummary(cycle) {
  const daysContributed = cycle.days_contributed
  const daysRemaining = 30 - daysContributed
  const totalSaved = parseFloat(cycle.total_saved)
  const dailyAmount = parseFloat(cycle.daily_amount)
  const commission = parseFloat(cycle.commission)
  const expectedTotal = totalSaved + (daysRemaining * dailyAmount)
  const expectedPayout = expectedTotal - commission
  const progressPercent = Math.round((daysContributed / 30) * 100)
  const filled = Math.round((daysContributed / 30) * 10)
  const progressBar = '[' + '#'.repeat(filled) + '-'.repeat(10 - filled) + ']'
  const canWithdraw = daysContributed >= 10

  return {
    totalSaved,
    daysContributed,
    daysRemaining,
    expectedTotal,
    commission,
    expectedPayout,
    progressPercent,
    progressBar,
    canWithdraw,
  }
}

// The check behind the PAID command — looks at Anchor's confirmed
// deposit record for today, does NOT record anything itself. Only the
// Anchor deposit webhook is allowed to create a contribution row.
export async function getTodaysContribution(cycleId) {
  const today = new Date().toISOString().split('T')[0]

  const { data } = await supabase
    .from('contributions')
    .select('id')
    .eq('cycle_id', cycleId)
    .eq('contribution_date', today)
    .single()

  return data
}
