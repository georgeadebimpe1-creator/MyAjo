// app/lib/session.js
//
// Session state (which step of the conversation a trader is on, plus any
// temporary answers they've given mid-flow). Pulled out of route.js so
// any future channel — a web form, a support tool, a second bot — can
// read or update where someone is in a flow without going through
// WhatsApp at all.
//
// Behavior is unchanged from the original functions in route.js —
// this is a straight extraction, not a rewrite.

import { supabase } from './supabase'

export async function getSession(whatsapp) {
  const { data } = await supabase
    .from('sessions')
    .select('*')
    .eq('whatsapp_number', whatsapp)
    .single()

  return data
}

export async function updateSession(whatsapp, step, tempData = {}) {
  const existing = await getSession(whatsapp)

  if (existing) {
    await supabase
      .from('sessions')
      .update({ step, temp_data: tempData, updated_at: new Date().toISOString() })
      .eq('whatsapp_number', whatsapp)
  } else {
    await supabase
      .from('sessions')
      .insert([{ whatsapp_number: whatsapp, step, temp_data: tempData }])
  }
}

export async function clearSession(whatsapp) {
  await supabase
    .from('sessions')
    .update({ step: 'welcome', temp_data: {} })
    .eq('whatsapp_number', whatsapp)
}
