// app/lib/withdrawalLogic.js
//
// Pure, testable math for MyAjo's withdrawal rules. No Supabase, no Twilio.
//
// THE RULES:
// 1. cycles.commission is already locked at cycle creation (= daily_amount).
//    This file doesn't touch that — it's just read as a given.
// 2. No withdrawal before day 10 (days_contributed >= 10).
// 3. Any withdrawal before day 30 — full or partial — costs a fee,
//    deducted from that withdrawal, always disclosed as Anchor's fee:
//      - N50 for withdrawals up to N10,000
//      - N100 for withdrawals above N10,000 (N50 payout fee + N50 stamp duty)
// 4. Day 30, full amount, no earlier withdrawals taken → N0 fee. MyAjo
//    absorbs Anchor's real fee out of the locked commission.
// 5. A withdrawal that empties the withdrawable balance behaves like a
//    full withdrawal — cycle ends.

export const MIN_DAYS_BEFORE_WITHDRAWAL = 10
export const CYCLE_DAYS = 30 // matches the hardcoded 30 used throughout route.js
export const EARLY_FEE_LOW = 50
export const EARLY_FEE_HIGH = 100
export const FEE_THRESHOLD = 10000

// NOTE: these all take cycleDayNumber (the trader's calendar day within
// the fixed 30-day cycle, from cycles.start_date) — not days_contributed
// (a count of payments). A cycle is calendar-bound: it unlocks and
// completes on schedule regardless of how many payments actually landed.
export function isWithdrawalUnlocked(cycleDayNumber) {
  return cycleDayNumber >= MIN_DAYS_BEFORE_WITHDRAWAL
}

export function isCycleComplete(cycleDayNumber) {
  return cycleDayNumber >= CYCLE_DAYS
}

export function calculateWithdrawalFee({ requestedAmount, cycleDayNumber, withdrawableBalance }) {
  const isFullWithdrawal = requestedAmount >= withdrawableBalance
  const isNaturalCompletion = isCycleComplete(cycleDayNumber) && isFullWithdrawal

  if (isNaturalCompletion) {
    return {
      fee: 0,
      feeReason: 'None — full 30 day cycle completed. MyAjo covers the banking fee.',
      payoutType: 'cycle_completion',
    }
  }

  const payoutType = isFullWithdrawal ? 'early_full' : 'early_partial'

  if (requestedAmount <= FEE_THRESHOLD) {
    return {
      fee: EARLY_FEE_LOW,
      feeReason: `Anchor payout fee (N${EARLY_FEE_LOW}). MyAjo does not charge this — it goes straight to our banking partner.`,
      payoutType,
    }
  }

  return {
    fee: EARLY_FEE_HIGH,
    feeReason: `Anchor payout fee plus stamp duty (N50 + N50 = N${EARLY_FEE_HIGH}). MyAjo does not charge this — it goes straight to our banking partner.`,
    payoutType,
  }
}

/**
 * Full pre-check. This is what gets shown to the trader BEFORE anything is
 * deducted — she must see this and reply YES before money moves.
 */
export function quoteWithdrawal({ requestedAmount, cycleDayNumber, withdrawableBalance }) {
  if (!isWithdrawalUnlocked(cycleDayNumber)) {
    return {
      allowed: false,
      reason: `Withdrawals unlock after day ${MIN_DAYS_BEFORE_WITHDRAWAL} of your cycle. You are currently on day ${cycleDayNumber}.`,
    }
  }

  if (!requestedAmount || requestedAmount <= 0) {
    return { allowed: false, reason: 'Enter an amount greater than N0.' }
  }

  if (requestedAmount > withdrawableBalance) {
    return {
      allowed: false,
      reason: `You can only withdraw up to N${withdrawableBalance.toLocaleString()} at this time.`,
    }
  }

  const { fee, feeReason, payoutType } = calculateWithdrawalFee({
    requestedAmount,
    cycleDayNumber,
    withdrawableBalance,
  })

  const netAmount = requestedAmount - fee

  return {
    allowed: true,
    requestedAmount,
    fee,
    feeReason,
    netAmount,
    payoutType,
    confirmationMessage:
      fee === 0
        ? `You will receive N${netAmount.toLocaleString()} in full. No charges, since you completed your full cycle.`
        : `You will receive N${netAmount.toLocaleString()} after a N${fee.toLocaleString()} charge (${feeReason})\n\nReply YES to confirm or NO to cancel.`,
  }
}
