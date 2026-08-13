// app/lib/savings.js
//
// The savings-cycle math and lookups that used to live inline inside
// the BALANCE, PAID, and onboarding steps of route.js. Pulling these
// out means the commission calculation exists in exactly one place —
// previously the same formula was repeated in three separate spots in
// route.js, which is how those spots quietly drift out of sync.
//
// Commission is now a tiered flat-fee table (agreed with the business
// team) instead of a flat percentage. Each daily savings amount maps
// to a fixed monthly fee — it does NOT scale purely on total savings.
import { supabase } from './supabase'

// Tiered commission table: { dailyAmount, fee }
// Sorted ascending by dailyAmount. A trader's daily amount is matched
// to the highest tier whose dailyAmount is <= their chosen amount.
export const COMMISSION_TIERS = [
  { dailyAmount: 1000, fee: 1000 },
  { dailyAmount: 2000, fee: 1800 },
  { dailyAmount: 3000, fee: 2500 },
  { dailyAmount: 4000, fee: 2500 },
  { dailyAmount: 5000, fee: 3000 },
  { dailyAmount: 6000, fee: 3500 },
  { dailyAmount: 7000, fee: 4000 },
  { dailyAmount: 8000, fee: 4000 },
  { dailyAmount: 9000, fee: 4000 },
  { dailyAmount: 10000, fee: 4000 },
]

export const MIN_DAILY_AMOUNT = 1000
export const MAX_DAILY_AMOUNT = 10000

// Onboarding is free-type (no preset buttons), so a trader can type
// any number. Rather than silently rounding an off-tier amount (e.g.
// ₦4,500) to a nearby fee, MyAjo only accepts the exact ten priced
// amounts. Anything else — too low, too high, or off-tier — is
// rejected here so it never reaches calculateCommission.
export function validateDailyAmount(dailyAmount) {
  if (typeof dailyAmount !== 'number' || !Number.isFinite(dailyAmount)) {
    return { valid: false, reason: 'Please enter a valid number like 1000, 2000....' }
  }
  if (dailyAmount < MIN_DAILY_AMOUNT) {
    return { valid: false, reason: `Minimum daily savings is ₦${MIN_DAILY_AMOUNT.toLocaleString()}.` }
  }
  if (dailyAmount > MAX_DAILY_AMOUNT) {
    return { valid: false, reason: `Maximum daily savings is ₦${MAX_DAILY_AMOUNT.toLocaleString()}.` }
  }
  const isValidTier = COMMISSION_TIERS.some(tier => tier.dailyAmount === dailyAmount)
  if (!isValidTier) {
    const validAmounts = COMMISSION_TIERS.map(t => `₦${t.dailyAmount.toLocaleString()}`).join(', ')
    return { valid: false, reason: `Please choose one of: ${validAmounts}.` }
  }
  return { valid: true, reason: null }
}

// Looks up the flat commission fee for a given daily savings amount.
// Assumes dailyAmount has already passed validateDailyAmount — this
// does an exact match, not a rounded/nearest-tier lookup.
export function calculateCommission(dailyAmount) {
  const matched = COMMISSION_TIERS.find(tier => tier.dailyAmount === dailyAmount)
  if (!matched) {
    throw new Error(`No commission tier found for daily amount: ${dailyAmount}`)
  }
  return matched.fee
}

// Used at the "how much per day" onboarding step, before a cycle exists,
// to show the trader what their 30-day plan will look like.
export function projectPlan(dailyAmount) {
  const { valid, reason } = validateDailyAmount(dailyAmount)
  if (!valid) {
    throw new Error(reason)
  }
  const totalSavings = dailyAmount * 30
  const commission = calculateCommission(dailyAmount)
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
  const { valid, reason } = validateDailyAmount(dailyAmount)
  if (!valid) {
    throw new Error(reason)
  }
  const totalSavings = dailyAmount * 30
  const commission = calculateCommission(dailyAmount)
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
