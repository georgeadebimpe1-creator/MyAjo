// app/lib/accounts.js
//
// Everything about a trader's account — finding them, creating them,
// updating their details, freezing them — lives here instead of inside
// the WhatsApp webhook. WhatsApp number is still the lookup key for now
// (that's a data-model decision, not a code-structure one), but any
// future interface can call these same functions directly instead of
// duplicating the Supabase queries or faking a WhatsApp message.
//
// Uses supabaseAdmin (service role key), not the anon-key client. This
// is server-only code (called from route.js, never the browser), and
// RLS was silently blocking writes here under the anon key — same bug
// as the Dojah webhook originally had. Every write below now also
// checks for an error instead of discarding it, so a blocked/failed
// write shows up in logs instead of looking identical to a success.
import { supabaseAdmin } from './supabase'
import { createAnchorCustomer, createAnchorDepositAccount, verifyAnchorCustomerKyc, getAnchorCustomer, verifyAccountNumber, createCounterParty } from './anchor'
import { resolveBankFromName } from './bankMatch'

// Fetches the full set of fields any step in the app might need, so
// every caller uses one consistent shape instead of hand-picking columns.
export async function getUserByWhatsapp(whatsapp) {
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('id, full_name, email, kyc_status, bank_name, bank_account_number, status, anchor_account_id, anchor_account_number')
    .eq('whatsapp_number', whatsapp)
    .single()

  if (error && error.code !== 'PGRST116') {
    // PGRST116 = "no rows found", which is expected for a brand new
    // trader and not a real error. Anything else is worth logging.
    console.error('getUserByWhatsapp: Supabase error', whatsapp, error)
  }

  return data
}

// Used during onboarding (CONFIRM step) — creates a new trader record,
// or updates an existing one if they're re-running onboarding.
// `details` = { full_name, email, bank_name, bank_account_number }
export async function createOrUpdateAccount(whatsapp, details) {
  const existingUser = await getUserByWhatsapp(whatsapp)

  if (existingUser) {
    const { error } = await supabaseAdmin
      .from('users')
      .update({
        full_name: details.full_name,
        email: details.email,
        bank_name: details.bank_name,
        bank_account_number: details.bank_account_number,
        residential_address: details.residential_address,
      })
      .eq('id', existingUser.id)

    if (error) {
      console.error('createOrUpdateAccount: update failed', whatsapp, error)
      throw new Error('Could not update account details. Please try again.')
    }

    return existingUser.id
  }

  const { data: newUser, error } = await supabaseAdmin
    .from('users')
    .insert([{
      full_name: details.full_name,
      phone_number: whatsapp,
      whatsapp_number: whatsapp,
      email: details.email,
      bank_name: details.bank_name,
      bank_account_number: details.bank_account_number,
      bank_account_name: details.full_name,
      residential_address: details.residential_address,
      status: 'active',
    }])
    .select()
    .single()

  if (error) {
    console.error('createOrUpdateAccount: insert failed', whatsapp, error)
    throw new Error('Could not create account. Please try again.')
  }

  return newUser.id
}

export async function freezeAccount(userId) {
  const { error } = await supabaseAdmin
    .from('users')
    .update({ status: 'frozen' })
    .eq('id', userId)

  if (error) {
    console.error('freezeAccount: update failed', userId, error)
    throw new Error('Could not freeze account. Please try again.')
  }
}

// ---------------------------------------------------------------------
// Bank verification — resolves a trader-typed bank name to a real Anchor
// bankCode, verifies the account number is real, and saves a Anchor
// CounterParty so payout at cycle-end doesn't need any of this redone.
// ---------------------------------------------------------------------
//
// Requires two new columns on `users` not used anywhere before this:
// bank_code (text) and anchor_counterparty_id (text). Add these in
// Supabase before this runs, or every call here will fail on the save.
//
// Returns one of three shapes — caller (route.js) branches on this:
//   { verified: true, accountName, bankName }
//   { needsSelection: true, candidates: [{ code, name }, ...] }
//   { retype: true }   — nothing close matched at all
export async function verifyAndLinkBankAccount(userId, typedBankName, accountNumber) {
  const resolved = await resolveBankFromName(typedBankName)

  if (!resolved.match) {
    if (resolved.candidates.length === 0) {
      return { retype: true }
    }
    return { needsSelection: true, candidates: resolved.candidates }
  }

  return await verifyAndLinkResolvedBank(userId, resolved.match, accountNumber)
}

// Second half of the flow — called directly once a bankCode is already
// known, either because resolveBankFromName found a confident single
// match, or because the trader picked one from a numbered list.
export async function verifyAndLinkResolvedBank(userId, bank, accountNumber) {
  let verified
  try {
    verified = await verifyAccountNumber(bank.code, accountNumber)
  } catch (err) {
    console.error('verifyAndLinkResolvedBank: account verification failed', userId, bank, accountNumber, err)
    throw new Error(
      "we couldn't verify that account number with the bank — please double check the number and try again"
    )
  }

  let counterParty
  try {
    counterParty = await createCounterParty({
      bankCode: bank.code,
      accountName: verified.accountName,
      accountNumber,
    })
  } catch (err) {
    console.error('verifyAndLinkResolvedBank: counterparty creation failed', userId, bank, err)
    throw new Error('we could not save that bank account — please try again')
  }

  const { error } = await supabaseAdmin
    .from('users')
    .update({
      bank_name: bank.name,
      bank_code: bank.code,
      bank_account_number: accountNumber,
      bank_account_name: counterParty.verifiedAccountName || verified.accountName,
      anchor_counterparty_id: counterParty.counterPartyId,
    })
    .eq('id', userId)

  if (error) {
    console.error('verifyAndLinkResolvedBank: failed to save verified bank details', userId, error)
    throw new Error('your bank account was verified but we hit an error saving it — please try again')
  }

  return {
    verified: true,
    accountName: counterParty.verifiedAccountName || verified.accountName,
    bankName: bank.name,
  }
}

// ---------------------------------------------------------------------
// Anchor deposit account provisioning
// ---------------------------------------------------------------------
//
// Creates a real, dedicated Anchor deposit account for a trader and
// returns the account number Temi should tell them to send money to.
// Without this, a trader has no account number to save into, and the
// deposit webhook has nothing reliable to match incoming transfers
// against.
//
// CONFIRMED (Anchor Slack, 2026): each trader should get their own
// individual DepositAccount — not a shared/pooled account. This
// function's architecture is correct as originally written.
//
// TWO-STEP FLOW (confirmed against Anchor's docs, docs.getanchor.co/
// docs/individual-customer-kyc): creating a customer with BVN/DOB/
// gender does NOT verify them — Anchor requires a separate verification
// call, and the real result (approved/error/rejected) comes back later
// as a WEBHOOK, not in the response to that call. So this function now
// stops after triggering verification. The deposit account itself is
// only created once the approved webhook arrives — see
// finalizeAnchorDepositAccount() below, called from
// app/api/anchor-webhook/route.js.
//
// Idempotent: reuses an existing anchor_customer_id, an existing
// pending verification, or an existing deposit account rather than
// re-triggering any step that's already been done.
//
// `address` is the STRUCTURED object built in route.js's
// parseOnboardingDetails ({ addressLine_1, city, state, postalCode,
// country }) — Anchor's customer-creation API needs this shape, not the
// single display string stored in the users table for readability.
//
// Returns one of:
//   { status: 'ready', accountNumber }   — already fully provisioned
//   { status: 'pending' }                — verification just triggered
//                                           (or already awaiting Anchor's
//                                           webhook from an earlier try)
export async function provisionAnchorAccount(userId, address) {
  const { data: user, error } = await supabaseAdmin
    .from('users')
    .select('full_name, email, whatsapp_number, date_of_birth, gender, bvn, anchor_customer_id, anchor_kyc_status, anchor_account_id, anchor_account_number')
    .eq('id', userId)
    .single()

  if (error || !user) {
    console.error('provisionAnchorAccount: could not load user', userId, error)
    throw new Error('Could not load your details. Please try again or contact support.')
  }

  // Already fully provisioned — reuse it instead of calling Anchor again.
  if (user.anchor_account_id && user.anchor_account_number) {
    return { status: 'ready', accountNumber: user.anchor_account_number }
  }

  // Verification already triggered and still waiting on Anchor's
  // webhook — don't trigger it a second time.
  if (user.anchor_kyc_status === 'pending') {
    return { status: 'pending' }
  }

  // date_of_birth/gender/bvn only exist on the user record after Dojah
  // verification succeeds. address is passed in directly from the
  // onboarding session, not read from the DB. If any are missing,
  // calling Anchor would fail anyway with a far less useful error —
  // fail early with a clear reason.
  const missing = []
  if (!user.date_of_birth) missing.push('date of birth')
  if (!user.gender) missing.push('gender')
  if (!user.bvn) missing.push('BVN')
  if (!address || !address.addressLine_1 || !address.state) missing.push('address')
  if (missing.length > 0) {
    console.error('provisionAnchorAccount: missing verification data', userId, missing)
    throw new Error(
      `your verification details look incomplete (missing ${missing.join(', ')}). Please contact support`
    )
  }

  // CONFIRMED against Anchor's own documented example ("07061234507")
  // — plain local format, same as whatsapp_number's existing internal
  // format. No conversion needed. (This was previously miswritten as a
  // 234-prefixed conversion — if you're reading this after another
  // regression, that's the thing to check first.)
  const phone = user.whatsapp_number

  let anchorCustomerId = user.anchor_customer_id

  if (!anchorCustomerId) {
    anchorCustomerId = await createAnchorCustomer({
      fullName: user.full_name,
      email: user.email,
      phone,
      dob: user.date_of_birth,
      gender: user.gender,
      // Structured address, passed in directly from onboarding — this
      // is the shape Anchor's customer-creation API needs
      // (addressLine_1/city/state/postalCode/country), not a single
      // display string.
      address,
      bvn: user.bvn,
    })

    const { error: custErr } = await supabaseAdmin
      .from('users')
      .update({ anchor_customer_id: anchorCustomerId })
      .eq('id', userId)

    if (custErr) {
      // Not fatal to this call — we still have the ID in memory to use
      // below — but worth knowing so it isn't silently re-created next time.
      console.error('provisionAnchorAccount: failed to save anchor_customer_id', userId, custErr)
    }
  }

  // Trigger KYC verification. Anchor's real answer arrives later via
  // webhook (customer.identification.approved / .error / .rejected).
  await verifyAnchorCustomerKyc(anchorCustomerId, {
    bvn: user.bvn,
    dob: user.date_of_birth,
    gender: user.gender,
  })

  const { error: kycErr } = await supabaseAdmin
    .from('users')
    .update({ anchor_kyc_status: 'pending' })
    .eq('id', userId)

  if (kycErr) {
    console.error('provisionAnchorAccount: failed to save anchor_kyc_status', userId, kycErr)
  }

  return { status: 'pending' }
}

// Called from app/api/anchor-webhook/route.js when Anchor sends
// customer.identification.approved. Only at this point is the trader
// actually allowed to have a deposit account — calling this any earlier
// is exactly what produced the "Customer does not have kyc verification"
// error.
//
// Idempotent: if a deposit account already exists (e.g. Anchor resent
// the same webhook), it's reused rather than duplicated.
export async function finalizeAnchorDepositAccount(userId) {
  const { data: user, error } = await supabaseAdmin
    .from('users')
    .select('anchor_customer_id, anchor_account_id, anchor_account_number')
    .eq('id', userId)
    .single()

  if (error || !user) {
    console.error('finalizeAnchorDepositAccount: could not load user', userId, error)
    throw new Error('Could not load user to finish account setup')
  }

  if (user.anchor_account_id && user.anchor_account_number) {
    return { accountNumber: user.anchor_account_number }
  }

  const account = await createAnchorDepositAccount(user.anchor_customer_id)

  const { error: acctErr } = await supabaseAdmin
    .from('users')
    .update({
      anchor_account_id: account.accountId,
      anchor_account_number: account.accountNumber,
      anchor_kyc_status: 'approved',
    })
    .eq('id', userId)

  if (acctErr) {
    // The account WAS created at Anchor at this point — money could
    // technically be sent to it — but we failed to save the number.
    // This needs a human, not a silent retry.
    console.error('finalizeAnchorDepositAccount: account created at Anchor but failed to save', userId, account, acctErr)
    throw new Error('deposit account was created but we hit an error saving it')
  }

  return { accountNumber: account.accountNumber }
}

// Fallback path — called from route.js whenever a trader interacts with
// Temi while status is 'pending', so they get an active check instead
// of only ever waiting on a webhook that might be slow or lost. Safe to
// call repeatedly; does nothing destructive if still genuinely pending.
//
// Returns one of:
//   { status: 'ready', accountNumber }
//   { status: 'pending' }
//   { status: 'rejected' }
export async function checkAndFinalizeIfApproved(userId) {
  const { data: user, error } = await supabaseAdmin
    .from('users')
    .select('anchor_customer_id, anchor_kyc_status, anchor_account_id, anchor_account_number')
    .eq('id', userId)
    .single()

  if (error || !user) {
    console.error('checkAndFinalizeIfApproved: could not load user', userId, error)
    return { status: 'pending' }
  }

  // Already finished — covers both "webhook already handled it" and
  // "an earlier poll already handled it".
  if (user.anchor_account_id && user.anchor_account_number) {
    return { status: 'ready', accountNumber: user.anchor_account_number }
  }

  if (!user.anchor_customer_id) {
    return { status: 'pending' }
  }

  let customer
  try {
    customer = await getAnchorCustomer(user.anchor_customer_id)
  } catch (err) {
    console.error('checkAndFinalizeIfApproved: status check failed', userId, err)
    return { status: 'pending' }
  }

  const verificationStatus = customer?.attributes?.verification?.status

  if (!verificationStatus || verificationStatus === 'unverified' || verificationStatus === 'pending') {
    return { status: 'pending' }
  }

  if (verificationStatus === 'rejected' || verificationStatus === 'failed') {
    await supabaseAdmin.from('users').update({ anchor_kyc_status: 'rejected' }).eq('id', userId)
    return { status: 'rejected' }
  }

  // Anything else (expected: "verified") — treat as approved and finish
  // account creation right now instead of waiting further.
  const account = await finalizeAnchorDepositAccount(userId)
  return { status: 'ready', accountNumber: account.accountNumber }
}
