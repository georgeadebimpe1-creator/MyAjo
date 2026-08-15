// app/lib/session.js
//
// Session state (which step of the conversation a trader is on, plus any
// temporary answers they've given mid-flow). Pulled out of route.js so
// any future channel — a web form, a support tool, a second bot — can
// read or update where someone is in a flow without going through
// WhatsApp at all.
//
// Uses supabaseAdmin (service role key), not the anon-key client. This
// is server-only code, and session state is the backbone of every
// multi-step conversation — a silently blocked write here (same RLS
// pattern found in the Dojah webhook and accounts.js) would show up as
// a trader's step never advancing, or temp_data mysteriously not
// persisting between messages, without any visible error. Every write
// below now checks for an error and logs it instead of discarding it.

import { supabaseAdmin } from './supabase'

export async function getSession(whatsapp) {
  const { data, error } = await supabaseAdmin
    .from('sessions')
    .select('*')
    .eq('whatsapp_number', whatsapp)
    .single()

  if (error && error.code !== 'PGRST116') {
    // PGRST116 = "no rows found" — expected for a trader with no
    // session yet, not a real error. Anything else is worth logging.
    console.error('getSession: Supabase error', whatsapp, error)
  }

  return data
}

export async function updateSession(whatsapp, step, tempData = {}) {
  const existing = await getSession(whatsapp)

  if (existing) {
    const { error } = await supabaseAdmin
      .from('sessions')
      .update({ step, temp_data: tempData, updated_at: new Date().toISOString() })
      .eq('whatsapp_number', whatsapp)

    if (error) {
      console.error('updateSession: update failed', whatsapp, step, error)
      throw new Error('Could not save your progress. Please try again.')
    }
  } else {
    const { error } = await supabaseAdmin
      .from('sessions')
      .insert([{ whatsapp_number: whatsapp, step, temp_data: tempData }])

    if (error) {
      console.error('updateSession: insert failed', whatsapp, step, error)
      throw new Error('Could not save your progress. Please try again.')
    }
  }
}

export async function clearSession(whatsapp) {
  const { error } = await supabaseAdmin
    .from('sessions')
    .update({ step: 'welcome', temp_data: {} })
    .eq('whatsapp_number', whatsapp)

  if (error) {
    console.error('clearSession: update failed', whatsapp, error)
    throw new Error('Could not reset your session. Please try again.')
  }
}
