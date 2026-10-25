// ===== LOOKUP: the "Find a trader" search =====
// GitHub path: app/api/dashboard-lookup/route.js  (NEW file)
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '../../lib/supabase'
import { getCycleDayNumber } from '../../lib/savings'

// Always fetch fresh numbers, never a saved copy.
export const dynamic = 'force-dynamic'

// Trader lookup for the organiser dashboard. Runs on the server with the
// admin database connection and sits behind the login check in
// middleware.js, so only a logged-in organiser can reach it.
//
// PRIVACY: this route picks its columns by name. It never reads BVN, PIN,
// email, home address or date of birth, and bank account numbers are sent
// with only the last four digits.

const USER_COLUMNS =
  'id, full_name, phone_number, whatsapp_number, language, status, kyc_status, anchor_account_id, anchor_counterparty_id, bank_name, bank_account_number, last_inbound_at, bank_change_fee_owed, created_at'

const MAX_RESULTS = 5

function num(value) {
  return parseFloat(value) || 0
}

function maskAccount(accountNumber) {
  if (!accountNumber) return null
  const s = String(accountNumber)
  return s.length <= 4 ? s : `******${s.slice(-4)}`
}

// Turns what the organiser typed into a safe search. Only digits are kept
// for phone searches and only letters for name searches, so typed text can
// never change the shape of the database query.
function buildSearch(raw) {
  const text = (raw || '').trim()
  const digits = text.replace(/\D/g, '')

  if (digits.length >= 6) {
    // Compare on the last 10 digits so +234..., 234... and 0... all match.
    return { kind: 'phone', value: digits.length > 10 ? digits.slice(-10) : digits }
  }

  const name = text.replace(/[^\p{L}\s'-]/gu, '').trim()
  if (name.length >= 2) {
    return { kind: 'name', value: name }
  }

  return null
}

export async function GET(request) {
  if (!supabaseAdmin) {
    console.error('dashboard-lookup: SUPABASE_SERVICE_ROLE_KEY is not set')
    return NextResponse.json({ error: 'Server is missing its database key' }, { status: 500 })
  }

  const q = new URL(request.url).searchParams.get('q') || ''
  const search = buildSearch(q)

  if (!search) {
    return NextResponse.json(
      { error: 'Type at least 6 digits of a phone number, or at least 2 letters of a name.' },
      { status: 400 }
    )
  }

  let userQuery = supabaseAdmin.from('users').select(USER_COLUMNS)
  if (search.kind === 'phone') {
    userQuery = userQuery.or(`whatsapp_number.ilike.%${search.value}%,phone_number.ilike.%${search.value}%`)
  } else {
    userQuery = userQuery.ilike('full_name', `%${search.value}%`)
  }

  const { data: users, error: usersError } = await userQuery
    .order('created_at', { ascending: false })
    .limit(MAX_RESULTS)

  if (usersError) {
    console.error('dashboard-lookup: user search failed', usersError)
    return NextResponse.json({ error: 'Search failed' }, { status: 500 })
  }

  if (!users || users.length === 0) {
    return NextResponse.json({ results: [] })
  }

  const ids = users.map((u) => u.id)

  const [cyclesRes, payoutsRes, contributionsRes, messagesRes] = await Promise.all([
    supabaseAdmin
      .from('cycles')
      .select('id, user_id, daily_amount, days_contributed, total_saved, commission, partial_withdrawals, status, start_date, paid_out_at')
      .in('user_id', ids)
      .order('start_date', { ascending: false }),
    supabaseAdmin
      .from('payouts')
      .select('id, cycle_id, user_id, gross_amount, net_amount, commission, payout_type, withdrawal_fee, bank_change_fee, status, initiated_at, completed_at, failed_reason, commission_swept')
      .in('user_id', ids)
      .order('initiated_at', { ascending: false }),
    supabaseAdmin
      .from('contributions')
      .select('user_id, amount, contribution_date, verified, created_at')
      .in('user_id', ids)
      .order('created_at', { ascending: false })
      .limit(200),
    supabaseAdmin
      .from('message_log')
      .select('user_id, message_type, send_method, sent_at')
      .in('user_id', ids)
      .order('sent_at', { ascending: false })
      .limit(100),
  ])

  const firstError = cyclesRes.error || payoutsRes.error || contributionsRes.error || messagesRes.error
  if (firstError) {
    console.error('dashboard-lookup: detail load failed', firstError)
    return NextResponse.json({ error: 'Could not load trader details' }, { status: 500 })
  }

  const allPayouts = payoutsRes.data || []

  // Money already taken out of each cycle (completed payouts only).
  const completedGross = {}
  for (const p of allPayouts) {
    if (p.status === 'completed') {
      completedGross[p.cycle_id] = (completedGross[p.cycle_id] || 0) + num(p.gross_amount)
    }
  }

  const results = users.map((u) => {
    const cycles = (cyclesRes.data || [])
      .filter((c) => c.user_id === u.id)
      .map((c) => {
        const isActive = c.status === 'active'
        const cycleDayNumber = isActive ? Math.min(Math.max(getCycleDayNumber(c.start_date), 1), 30) : null
        const totalSaved = num(c.total_saved)
        const commission = num(c.commission)
        return {
          id: c.id,
          status: c.status,
          startDate: c.start_date,
          dailyAmount: num(c.daily_amount),
          daysContributed: c.days_contributed || 0,
          cycleDayNumber,
          withdrawalsUnlocked: isActive ? cycleDayNumber >= 10 : null,
          totalSaved,
          commission,
          // Same formula the bot uses: saved, minus the reserved commission,
          // minus what has already been paid out.
          withdrawableNow: isActive ? Math.max(totalSaved - commission - (completedGross[c.id] || 0), 0) : null,
          partialWithdrawals: c.partial_withdrawals || 0,
          paidOutAt: c.paid_out_at,
        }
      })

    const payouts = allPayouts
      .filter((p) => p.user_id === u.id)
      .slice(0, 10)
      .map((p) => ({
        id: p.id,
        type: p.payout_type,
        status: p.status,
        grossAmount: num(p.gross_amount),
        netAmount: num(p.net_amount),
        commission: num(p.commission),
        commissionMoved: p.commission_swept === true,
        fee: num(p.withdrawal_fee) + num(p.bank_change_fee),
        initiatedAt: p.initiated_at,
        completedAt: p.completed_at,
        failedReason: p.failed_reason,
      }))

    const myContributions = (contributionsRes.data || []).filter((c) => c.user_id === u.id)

    const recentMessages = (messagesRes.data || [])
      .filter((m) => m.user_id === u.id)
      .slice(0, 10)
      .map((m) => ({ type: m.message_type, method: m.send_method, sentAt: m.sent_at }))

    return {
      profile: {
        id: u.id,
        fullName: u.full_name,
        whatsappNumber: u.whatsapp_number,
        phoneNumber: u.phone_number,
        language: u.language,
        accountStatus: u.status,
        kycStatus: u.kyc_status,
        signedUpAt: u.created_at,
        lastMessageFromTraderAt: u.last_inbound_at,
        depositAccountReady: !!u.anchor_account_id,
        payoutBankReady: !!u.anchor_counterparty_id,
        bankName: u.bank_name,
        bankAccountMasked: maskAccount(u.bank_account_number),
        bankChangeFeeOwed: num(u.bank_change_fee_owed),
      },
      cycles,
      payouts,
      lastPaymentDate: myContributions[0]?.contribution_date || null,
      recentContributions: myContributions.slice(0, 5).map((c) => ({
        date: c.contribution_date,
        amount: num(c.amount),
        verified: c.verified === true,
      })),
      recentMessages,
    }
  })

  return NextResponse.json({ results })
}
