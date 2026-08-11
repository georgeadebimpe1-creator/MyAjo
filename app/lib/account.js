// app/lib/accounts.js
//
// Everything about a trader's account — finding them, creating them,
// updating their details, freezing them — lives here instead of inside
// the WhatsApp webhook. WhatsApp number is still the lookup key for now
// (that's a data-model decision, not a code-structure one), but any
// future interface can call these same functions directly instead of
// duplicating the Supabase queries or faking a WhatsApp message.
//
// Behavior is unchanged from the original inline queries in route.js.

import { supabase } from './supabase'

// Fetches the full set of fields any step in the app might need, so
// every caller uses one consistent shape instead of hand-picking columns.
export async function getUserByWhatsapp(whatsapp) {
  const { data } = await supabase
    .from('users')
    .select('id, full_name, email, kyc_status, bank_name, bank_account_number, status')
    .eq('whatsapp_number', whatsapp)
    .single()

  return data
}

// Used during onboarding (CONFIRM step) — creates a new trader record,
// or updates an existing one if they're re-running onboarding.
// `details` = { full_name, email, bank_name, bank_account_number }
export async function createOrUpdateAccount(whatsapp, details) {
  const existingUser = await getUserByWhatsapp(whatsapp)

  if (existingUser) {
    await supabase
      .from('users')
      .update({
        full_name: details.full_name,
        email: details.email,
        bank_name: details.bank_name,
        bank_account_number: details.bank_account_number,
      })
      .eq('id', existingUser.id)

    return existingUser.id
  }

  const { data: newUser } = await supabase
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

  return newUser.id
}

export async function freezeAccount(userId) {
  await supabase
    .from('users')
    .update({ status: 'frozen' })
    .eq('id', userId)
}
