// app/lib/bankChange.js
//
// Rules and small helpers for the CHANGEBANK flow. Kept in one place so
// the WhatsApp route, the Dojah webhook and the withdrawal code all use
// the same numbers.
//
// THE RULES (decided with Bimpe):
// - A trader can change their payout bank account, but must redo the
//   BVN + selfie check (Dojah widget) and the BVN must match the one
//   already on file.
// - Fee: N200, NOT charged up front. It is recorded as "owed"
//   (users.bank_change_fee_owed) and taken at the trader's next payout,
//   together with the commission. See withdrawal.js.
// - One successful change every 30 days (users.last_bank_change_at).
// - Withdrawals (including the automatic day-30 payout) are paused for
//   24 hours after a successful change.
// - At most 3 failed selfie checks per CHANGEBANK attempt.

import { supabaseAdmin } from './supabase'

export const BANK_CHANGE_FEE = 200
export const BANK_CHANGE_COOLDOWN_DAYS = 30
export const BANK_CHANGE_HOLD_HOURS = 24
export const BANK_CHANGE_MAX_FAILED_CHECKS = 3

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

function formatDate(d) {
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Africa/Lagos' })
}

function formatDateTime(d) {
  return new Date(d).toLocaleString('en-GB', {
    day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Africa/Lagos',
  })
}

// Pure. `now` is injectable so this can be tested without waiting.
export function checkBankChangeEligibility(user, now = Date.now()) {
  if (!user) return { ok: false, reason: 'no_account' }
  if (user.status === 'frozen') return { ok: false, reason: 'frozen' }
  if (user.kyc_status !== 'verified' || !user.anchor_account_id || !user.anchor_counterparty_id) {
    return { ok: false, reason: 'not_set_up' }
  }
  if (!user.bvn) return { ok: false, reason: 'no_bvn' }

  if (user.last_bank_change_at) {
    const eligibleAt = new Date(user.last_bank_change_at).getTime() + BANK_CHANGE_COOLDOWN_DAYS * DAY_MS
    if (now < eligibleAt) {
      return { ok: false, reason: 'cooldown', eligibleOn: formatDate(eligibleAt) }
    }
  }
  return { ok: true }
}

// Pure. Is this trader's withdrawal paused because of a recent bank change?
export function getWithdrawalHold(user, now = Date.now()) {
  if (!user || !user.last_bank_change_at) return { held: false }
  const until = new Date(user.last_bank_change_at).getTime() + BANK_CHANGE_HOLD_HOURS * HOUR_MS
  if (now < until) {
    return {
      held: true,
      until,
      message: `For your security, withdrawals are paused for ${BANK_CHANGE_HOLD_HOURS} hours after a bank account change. You can withdraw again after ${formatDateTime(until)}.`,
    }
  }
  return { held: false }
}

function nameTokens(name) {
  return String(name || '')
    .toUpperCase()
    .replace(/[^A-Z\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1)
}

// Pure. True when the bank's account name shares at least two name
// parts with the BVN name (order-independent), or all parts if either
// name has fewer than two. Deliberately loose: banks and BVN records
// often differ on middle names and word order.
export function namesLikelyMatch(bvnName, accountName) {
  const a = nameTokens(bvnName)
  const b = nameTokens(accountName)
  if (a.length === 0 || b.length === 0) return false
  const shared = a.filter((t) => b.includes(t)).length
  const needed = Math.min(2, a.length, b.length)
  return shared >= needed
}

// Whether the account-name check is enforced. Off by default because
// Dojah's SANDBOX returns the same fake identity for everyone, so real
// account names would never match it. Set BANKCHANGE_ENFORCE_NAME_MATCH=true
// in Vercel when going live.
export function isNameMatchEnforced() {
  return process.env.BANKCHANGE_ENFORCE_NAME_MATCH === 'true'
}

export async function getUserForBankChange(whatsapp) {
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('id, full_name, status, kyc_status, bvn, anchor_account_id, anchor_counterparty_id, bank_name, bank_account_number, last_bank_change_at, bank_change_fee_owed, language')
    .eq('whatsapp_number', whatsapp)
    .maybeSingle()

  if (error) {
    console.error('getUserForBankChange: Supabase error', whatsapp, error)
    return null
  }
  return data
}

// Records a successful change: starts the 30-day cooldown and the 24h
// withdrawal pause, and adds the N200 fee to what is owed at payout.
// Throws if the write fails so the caller never tells a trader it worked
// when the fee/hold were not saved.
export async function recordBankChange(userId, currentFeeOwed = 0) {
  const { error } = await supabaseAdmin
    .from('users')
    .update({
      last_bank_change_at: new Date().toISOString(),
      bank_change_fee_owed: parseFloat(currentFeeOwed || 0) + BANK_CHANGE_FEE,
    })
    .eq('id', userId)

  if (error) {
    console.error('recordBankChange: failed to save', userId, error)
    throw new Error('We changed your bank but could not finish saving the details. Please contact support.')
  }
}
