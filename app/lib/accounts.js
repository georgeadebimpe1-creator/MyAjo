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
// as the Dojah webhook originally had. Every write below also checks
// for an error instead of discarding it, so a blocked/failed write
// shows up in logs instead of looking identical to a success.
import { supabaseAdmin } from './supabase'
import { createAnchorCustomer, createAnchorDepositAccount } from './anchor'

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
// `details` = { full_name, email, bank_name, bank_account_number, residential_address }
// `residential_address` here is a plain readable string for record-keeping
// (e.g. "12 Market Road, Ikeja, Lagos") — the structured version Anchor
// actually needs is built separately and passed straight to
// provisionAnchorAccount, not round-tripped through this column.
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
// Anchor deposit account provisioning
// ---------------------------------------------------------------------
//
// Creates a real, dedicated Anchor deposit account for a trader and
// returns the account number Temi tells them to send money to.
//
// STATUS: not yet tested against Anchor's sandbox. anchor.js is built
// from Anchor's real documented examples (confirmed 2026-08-16), but
// "matches the docs" and "works against a live sandbox response" are
// two different things until it's actually been run once for real.
//
// Idempotent: if this trader already has an anchor_account_id on file,
// it's reused rather than creating a duplicate account at Anchor.
//
// `typedAddress` — the structured address the trader typed during
// onboarding: { addressLine_1, city, state, postalCode, country }.
// Dojah's own residential_address field came back empty in sandbox
// testing (and is unreliable in general — many real BVN records lack
// it), so address is no longer sourced from the Dojah-populated column
// at all. It must be passed in here directly from the onboarding flow.
export async function provisionAnchorAccount(userId, typedAddress) {
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

  // date_of_birth, gender, and bvn only exist on the user record after
  // Dojah verification succeeds. address now comes from the trader's
  // own onboarding input, not the database.
  const missing = []
  if (!user.date_of_birth) missing.push('date of birth')
  if (!user.gender) missing.push('gender')
  if (!user.bvn) missing.push('BVN')
  if (!typedAddress || !typedAddress.addressLine_1 || !typedAddress.state) missing.push('address')
  if (missing.length > 0) {
    console.error('provisionAnchorAccount: missing required data', userId, missing)
    throw new Error(
      `your verification details look incomplete (missing ${missing.join(', ')}). Please contact support`
    )
  }

  // date_of_birth is stored in a Postgres `date` column, which
  // PostgREST/Supabase normally returns as ISO (YYYY-MM-DD) regardless
  // of the format Dojah originally sent ("01-Jun-1982" in sandbox
  // testing). This is a defensive fallback only, in case that
  // assumption is ever wrong — it leaves an already-ISO date untouched.
  const dob = formatDobIfNeeded(user.date_of_birth)

  // Anchor's own documented example uses the plain local format
  // ("07061234507"), matching whatsapp_number's existing internal
  // format exactly — no conversion needed.
  const phone = user.whatsapp_number

  let anchorCustomerId = user.anchor_customer_id

  if (!anchorCustomerId) {
    anchorCustomerId = await createAnchorCustomer({
      fullName: user.full_name,
      email: user.email,
      phone,
      dob,
      gender: user.gender,
      address: typedAddress,
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

const MONTH_ABBREVIATIONS = {
  Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
  Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12',
}

function formatDobIfNeeded(raw) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return raw // already ISO — the expected case
  }
  const match = /^(\d{2})-([A-Za-z]{3})-(\d{4})$/.exec(raw)
  if (match) {
    const [, day, monthAbbr, year] = match
    const month = MONTH_ABBREVIATIONS[monthAbbr]
    if (month) return `${year}-${month}-${day}`
  }
  return raw // unrecognized format — pass through so a failure is visible, not silently wrong
}
