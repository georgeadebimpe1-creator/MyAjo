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
