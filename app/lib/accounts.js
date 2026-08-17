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
import { createAnchorCustomer, createAnchorDepositAccount, verifyAccountNumber, createCounterParty } from './anchor'
import { resolveBankFromName } from './bankMatch'

// Fetches the full set of fields any step in the app might need, so
// every caller uses one consistent shape instead of hand-picking columns.
export async function getUserByWhatsapp(whatsapp) {
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('id, full_name, email, kyc_status, bank_name, bank_account_number, status')
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
// STATUS: not yet tested against Anchor's sandbox. anchor.js itself is
// built strictly from Anchor's public docs (see comments in that file)
// — not confirmed against a real response. Treat this whole function
// as "should work in principle" until it's been run once for real.
//
// Idempotent: if this trader already has an anchor_account_id on file,
// it's reused rather than creating a duplicate account at Anchor.
//
// `address` is the STRUCTURED object built in route.js's
// parseOnboardingDetails ({ addressLine_1, city, state, postalCode,
// country }) — Anchor's customer-creation API needs this shape, not the
// single display string stored in the users table for readability.
// Passed in directly from the onboarding flow rather than re-read from
// residential_address (which only holds the display string) since that
// was the exact gap flagged as "most likely to need fixing" before.
export async function provisionAnchorAccount(userId, address) {
  const { data: user, error } = await supabaseAdmin
    .from('users')
    .select('full_name, email, whatsapp_number, date_of_birth, gender, bvn, anchor_customer_id, anchor_account_id, anchor_account_number')
    .eq('id', userId)
    .single()

  if (error || !user) {
    console.error('provisionAnchorAccount: could not load user', userId, error)
    throw new Error('Could not load your details. Please try again or contact support.')
  }

  // Already provisioned — reuse it instead of calling Anchor again.
  if (user.anchor_account_id && user.anchor_account_number) {
    return { accountNumber: user.anchor_account_number }
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

  // Anchor's docs expect phone numbers in 234XXXXXXXXXX format.
  // whatsapp_number is stored internally as 0XXXXXXXXXX. UNCONFIRMED —
  // verify this is really the format Anchor wants before trusting it.
  const phone = '234' + user.whatsapp_number.slice(1)

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

  const account = await createAnchorDepositAccount(anchorCustomerId)

  const { error: acctErr } = await supabaseAdmin
    .from('users')
    .update({
      anchor_account_id: account.accountId,
      anchor_account_number: account.accountNumber,
    })
    .eq('id', userId)

  if (acctErr) {
    // The account WAS created at Anchor at this point — money could
    // technically be sent to it — but we failed to save the number.
    // This needs a human, not a silent retry.
    console.error('provisionAnchorAccount: account created at Anchor but failed to save', userId, account, acctErr)
    throw new Error('your deposit account was created but we hit an error saving it — please contact support before making any transfer')
  }

  return { accountNumber: account.accountNumber }
}
