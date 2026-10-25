// ===== ATTENTION: the "Needs attention" list =====
// GitHub path: app/api/dashboard-attention/route.js  (NEW file)
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '../../lib/supabase'
import { getCycleDayNumber } from '../../lib/savings'

// Always fetch fresh numbers, never a saved copy.
export const dynamic = 'force-dynamic'

// "Needs attention" list for the organiser dashboard. Runs on the server
// with the admin database connection and sits behind the login check in
// middleware.js. Reads only the columns it needs: no BVN, PIN or bank
// account numbers.
//
// Thresholds are easy to change here:
const VERIFICATION_STUCK_AFTER_HOURS = 24   // pending verification older than this is "stuck"
const PENDING_PAYOUT_AFTER_MINUTES = 60     // a payout still pending after this is "stuck"
const NEVER_SAVED_AFTER_DAYS = 2            // verified this long ago, still no savings
const BEHIND_BY_DAYS = 3                    // missed payments before a saver shows as "behind"
const MAX_PER_CATEGORY = 50

function num(value) {
  return parseFloat(value) || 0
}

function hoursSince(iso) {
  return (Date.now() - new Date(iso).getTime()) / 3600000
}

export async function GET() {
  if (!supabaseAdmin) {
    console.error('dashboard-attention: SUPABASE_SERVICE_ROLE_KEY is not set')
    return NextResponse.json({ error: 'Server is missing its database key' }, { status: 500 })
  }

  const [usersRes, cyclesRes, payoutsRes] = await Promise.all([
    supabaseAdmin
      .from('users')
      .select('id, full_name, whatsapp_number, status, kyc_status, anchor_account_id, anchor_counterparty_id, created_at'),
    supabaseAdmin
      .from('cycles')
      .select('id, user_id, daily_amount, days_contributed, total_saved, status, start_date'),
    supabaseAdmin
      .from('payouts')
      .select('id, cycle_id, user_id, gross_amount, commission, payout_type, status, initiated_at, failed_reason'),
  ])

  const firstError = usersRes.error || cyclesRes.error || payoutsRes.error
  if (firstError) {
    console.error('dashboard-attention: load failed', firstError)
    return NextResponse.json({ error: 'Could not load the attention list' }, { status: 500 })
  }

  const users = usersRes.data || []
  const cycles = cyclesRes.data || []
  const payouts = payoutsRes.data || []

  const userById = {}
  for (const u of users) userById[u.id] = u
  const cycleById = {}
  for (const c of cycles) cycleById[c.id] = c

  const who = (u) => ({
    userId: u.id,
    name: u.full_name || 'No name yet',
    whatsapp: u.whatsapp_number,
  })

  // ---- 1. Payouts with a problem -------------------------------------
  const payoutProblems = []
  for (const p of payouts) {
    const u = userById[p.user_id]
    if (!u) continue
    const cycle = cycleById[p.cycle_id]
    const isCommissionOnly = p.payout_type === 'commission_collection'
    const label = isCommissionOnly ? 'Commission collection' : 'Payout'

    if (p.status === 'pending' && hoursSince(p.initiated_at) * 60 >= PENDING_PAYOUT_AFTER_MINUTES) {
      payoutProblems.push({
        ...who(u),
        detail: `${label} of N${num(isCommissionOnly ? p.commission : p.gross_amount).toLocaleString()} has been pending since ${p.initiated_at.slice(0, 16).replace('T', ' ')}. Check Anchor to see whether the money moved.`,
      })
    } else if (p.status === 'failed' && cycle && cycle.status === 'active') {
      // Only open problems: a failed attempt on a cycle that is still
      // active and has not since been paid out.
      const laterCompleted = payouts.some(
        (o) =>
          o.cycle_id === p.cycle_id &&
          o.status === 'completed' &&
          o.payout_type === p.payout_type &&
          new Date(o.initiated_at) > new Date(p.initiated_at)
      )
      if (!laterCompleted) {
        payoutProblems.push({
          ...who(u),
          detail: `${label} failed: ${p.failed_reason || 'no reason recorded'}`,
        })
      }
    }
  }

  // ---- 2. Cycles that should have closed but did not -----------------
  const overdueCycles = []
  // ---- 3. Savers who are falling behind ------------------------------
  const behind = []
  for (const c of cycles) {
    if (c.status !== 'active') continue
    const u = userById[c.user_id]
    if (!u) continue
    const day = getCycleDayNumber(c.start_date)

    if (day >= 30) {
      overdueCycles.push({
        ...who(u),
        detail: `Cycle reached day ${day} but is still open. The daily job should close it; check it ran.`,
      })
      continue
    }

    // Today's payment may simply not have arrived yet, so only count
    // days that are fully over.
    const missed = Math.max(day - 1 - (c.days_contributed || 0), 0)
    if (missed >= BEHIND_BY_DAYS) {
      behind.push({
        ...who(u),
        detail: `Day ${day} of 30, paid ${c.days_contributed || 0} days, about ${missed} missed (N${num(c.daily_amount).toLocaleString()}/day).`,
        sort: missed,
      })
    }
  }
  behind.sort((a, b) => b.sort - a.sort)

  // ---- 4. Verification stuck or failed -------------------------------
  const verificationStuck = []
  // ---- 5. Verified but set-up not finished ---------------------------
  const setupIncomplete = []
  // ---- 6. Verified but never saved -----------------------------------
  const neverSaved = []
  // ---- 7. Frozen or otherwise not active accounts --------------------
  const frozen = []

  const everSaved = new Set(
    cycles.filter((c) => num(c.total_saved) > 0 || (c.days_contributed || 0) > 0).map((c) => c.user_id)
  )

  for (const u of users) {
    const age = hoursSince(u.created_at)

    if (u.status && u.status !== 'active') {
      frozen.push({ ...who(u), detail: `Account status is "${u.status}".` })
    }

    if (u.kyc_status === 'failed') {
      verificationStuck.push({ ...who(u), detail: 'Identity verification failed.', sort: 1e9 })
    } else if (u.kyc_status === 'pending' && age >= VERIFICATION_STUCK_AFTER_HOURS) {
      verificationStuck.push({
        ...who(u),
        detail: `Verification still pending after ${Math.floor(age / 24)} day${Math.floor(age / 24) === 1 ? '' : 's'}.`,
        sort: age,
      })
    }

    if (u.kyc_status === 'verified') {
      const missing = []
      if (!u.anchor_account_id) missing.push('savings account not created')
      if (!u.anchor_counterparty_id) missing.push('payout bank not verified')
      if (missing.length > 0) {
        setupIncomplete.push({ ...who(u), detail: `Verified, but ${missing.join(' and ')}.` })
      }

      if (!everSaved.has(u.id) && age >= NEVER_SAVED_AFTER_DAYS * 24) {
        neverSaved.push({
          ...who(u),
          detail: `Verified ${Math.floor(age / 24)} days ago, no savings yet.`,
          sort: age,
        })
      }
    }
  }
  verificationStuck.sort((a, b) => b.sort - a.sort)
  neverSaved.sort((a, b) => b.sort - a.sort)

  const category = (key, title, hint, items) => ({
    key,
    title,
    hint,
    count: items.length,
    items: items.slice(0, MAX_PER_CATEGORY).map(({ sort, ...rest }) => rest),
  })

  const categories = [
    category('payoutProblems', 'Payout problems', 'Money may be stuck. Check these first.', payoutProblems),
    category('overdueCycles', 'Cycles that did not close', 'Day 30 has passed and the cycle is still open.', overdueCycles),
    category('verificationStuck', 'Verification stuck or failed', 'These traders cannot start saving yet.', verificationStuck),
    category('setupIncomplete', 'Set-up not finished', 'Verified, but cannot receive or be paid yet.', setupIncomplete),
    category('behind', 'Falling behind', `Missed ${BEHIND_BY_DAYS} or more payments in an active cycle.`, behind),
    category('neverSaved', 'Verified, never saved', `Verified over ${NEVER_SAVED_AFTER_DAYS} days ago with no savings. Each one cost you the verification fee.`, neverSaved),
    category('frozen', 'Frozen accounts', 'Accounts that are not active.', frozen),
  ]

  return NextResponse.json({
    total: categories.reduce((sum, c) => sum + c.count, 0),
    categories,
  })
}
