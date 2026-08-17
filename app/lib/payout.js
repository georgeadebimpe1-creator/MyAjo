// app/lib/payout.js
//
// Real Anchor payout — replaces stubPayout. Two transfers per full
// cycle-completion payout:
//   1. BookTransfer: sweep the commission from the trader's own
//      DepositAccount into MyAjo's master DepositAccount (free, instant,
//      both internal to Anchor).
//   2. NIPTransfer: send the remaining net amount from the trader's
//      DepositAccount to their own external bank, via the CounterParty
//      created and verified during onboarding (see accounts.js).
//
// For a partial/early withdrawal (commission === 0, since commission is
// only charged at full cycle completion — see withdrawal.js), only the
// NIP transfer happens.
//
// STATUS: not yet tested against Anchor's sandbox. Built from Anchor's
// confirmed transfer docs (amount in kobo, BookTransfer supports
// DepositAccount-to-DepositAccount, NIPTransfer requires a CounterParty)
// — the endpoint shapes are confirmed, but this exact flow hasn't been
// run against a real account yet.
import { supabaseAdmin } from './supabase'
import { initiateBookTransfer, initiateNipTransfer, verifyTransfer } from './anchor'

const ANCHOR_MASTER_ACCOUNT_ID = process.env.ANCHOR_MASTER_ACCOUNT_ID

/**
 * @param {object} params
 * @param {string} params.userId - trader's Supabase user id
 * @param {number} params.amount - NET amount (after commission) to pay out, in Naira
 * @param {number} [params.commission] - commission to sweep, in Naira. 0/omitted for partial withdrawals.
 * @returns {Promise<{ success: boolean, bankReference?: string, reason?: string }>}
 */
export async function anchorPayout({ userId, amount, commission = 0 }) {
  if (!ANCHOR_MASTER_ACCOUNT_ID) {
    console.error('anchorPayout: ANCHOR_MASTER_ACCOUNT_ID is not set')
    return { success: false, reason: 'Payout is not fully configured yet. Please contact support.' }
  }

  const { data: user, error } = await supabaseAdmin
    .from('users')
    .select('anchor_account_id, anchor_counterparty_id, full_name')
    .eq('id', userId)
    .single()

  if (error || !user) {
    console.error('anchorPayout: could not load user', userId, error)
    return { success: false, reason: 'Could not load your account details.' }
  }

  if (!user.anchor_account_id) {
    console.error('anchorPayout: user has no anchor_account_id', userId)
    return { success: false, reason: 'Your deposit account is not set up yet.' }
  }

  if (!user.anchor_counterparty_id) {
    console.error('anchorPayout: user has no anchor_counterparty_id', userId)
    return { success: false, reason: 'Your payout bank account is not verified yet. Please contact support.' }
  }

  const reference = `myajo-payout-${userId}-${Date.now()}`

  // Step 1: sweep the commission, if any. This happens BEFORE the net
  // payout so that if the sweep fails, no money has left the trader's
  // account to an external bank yet — easier to recover from.
  if (commission > 0) {
    try {
      const sweep = await initiateBookTransfer({
        fromAccountId: user.anchor_account_id,
        toAccountId: ANCHOR_MASTER_ACCOUNT_ID,
        amountNaira: commission,
        reason: 'MyAjo commission',
        reference: `${reference}-commission`,
      })
      if (sweep.status !== 'COMPLETED' && sweep.status !== 'PENDING') {
        console.error('anchorPayout: commission sweep returned unexpected status', userId, sweep)
        return { success: false, reason: 'Commission could not be processed. Please contact support.' }
      }
    } catch (err) {
      console.error('anchorPayout: commission sweep failed', userId, err)
      return { success: false, reason: 'Commission could not be processed. Please contact support.' }
    }
  }

  // Step 2: pay the net amount out to the trader's own bank.
  let transfer
  try {
    transfer = await initiateNipTransfer({
      fromAccountId: user.anchor_account_id,
      counterPartyId: user.anchor_counterparty_id,
      amountNaira: amount,
      reason: 'MyAjo savings payout',
      reference,
    })
  } catch (err) {
    console.error('anchorPayout: NIP transfer failed to initiate', userId, err)
    return { success: false, reason: 'Payout transfer could not be started. Please contact support.' }
  }

  // NIP transfers commonly come back PENDING from the initiate call —
  // do a single follow-up check rather than treating PENDING as either
  // a guaranteed success or a failure. If it's still not resolved,
  // still report success here (the transfer WAS validly initiated) but
  // log clearly, since this is exactly the kind of gap the alert system
  // in withdrawal.js is designed to catch downstream if the DB write
  // that follows this call fails too.
  let finalStatus = transfer.status
  if (finalStatus === 'PENDING') {
    try {
      const verified = await verifyTransfer(transfer.transferId)
      finalStatus = verified.status
    } catch (err) {
      console.error('anchorPayout: could not verify transfer status, treating as still pending', userId, transfer.transferId, err)
    }
  }

  if (finalStatus === 'FAILED' || finalStatus === 'REVERSED') {
    console.error('anchorPayout: NIP transfer ended in failure', userId, transfer.transferId, finalStatus)
    return { success: false, reason: 'Payout transfer failed. Please contact support.' }
  }

  if (finalStatus !== 'COMPLETED') {
    console.error('anchorPayout: NIP transfer still not completed after one check — needs follow-up', userId, transfer.transferId, finalStatus)
  }

  return { success: true, bankReference: transfer.transferId }
}
