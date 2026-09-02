// app/lib/whatsapp.js
//
// Two send paths now exist:
//   sendMessage()          — free-form text, type: 'text'. Only works
//                             inside an open 24h customer service window.
//                             Use this for direct replies to something
//                             the trader just typed (BALANCE, PAID, menu
//                             navigation, etc) — the window is always
//                             open in that case, since they just messaged.
//   sendTemplateMessage()  — an approved WhatsApp Message Template.
//                             Works regardless of window state. Use this
//                             for anything PROACTIVE (Temi messaging
//                             first) — daily_reminder, contribution_recorded,
//                             cycle_complete.
//   sendProactiveMessage() — convenience wrapper for the proactive case:
//                             pass both a text body and template details,
//                             it checks lastInboundAt and picks the right
//                             one automatically. Prefer this over calling
//                             sendMessage/sendTemplateMessage directly for
//                             anything Temi sends without being asked.
//
// TEMPLATE NAMES BELOW ARE PLACEHOLDERS — must match EXACTLY what's
// approved in Meta Business Manager once submitted. Update
// TEMPLATE_NAMES before relying on the template path.
//
// message_log: every send (text or template) writes one row, best-effort
// — a logging failure never blocks or fails the actual send.

import { supabaseAdmin } from './supabase'

const META_TOKEN = process.env.META_WHATSAPP_TOKEN
const META_PHONE_NUMBER_ID = process.env.META_PHONE_NUMBER_ID
const META_API_URL = `https://graph.facebook.com/v20.0/${META_PHONE_NUMBER_ID}/messages`

// WhatsApp windows are 24h; using 23h here as a safety margin so a
// message doesn't get built as 'text' right as the window is closing
// and then get rejected by Meta mid-flight.
const WINDOW_SAFETY_MARGIN_MS = 23 * 60 * 60 * 1000

// Placeholder names — replace with whatever Meta actually approves.
// Language suffix pattern assumed (e.g. _en, _ha) to match the existing
// per-language content in lib/messages.js once these are translated.
export const TEMPLATE_NAMES = {
  daily_reminder: { en: 'myajo_daily_reminder_en' },
  contribution_recorded: { en: 'myajo_contribution_recorded_en' },
  cycle_complete: { en: 'myajo_cycle_complete_en' },
}

export function isWindowOpen(lastInboundAt) {
  if (!lastInboundAt) return false
  const last = new Date(lastInboundAt).getTime()
  if (Number.isNaN(last)) return false
  return Date.now() - last < WINDOW_SAFETY_MARGIN_MS
}

// Best-effort logging — never throws, never blocks the caller. A gap in
// message_log is a reporting inconvenience; a blocked trader message
// over a logging bug would be a much worse trade.
async function logMessage({ to, userId, messageType, sendMethod }) {
  if (!supabaseAdmin) return
  try {
    const { error } = await supabaseAdmin.from('message_log').insert([{
      whatsapp_number: to,
      user_id: userId || null,
      message_type: messageType || 'general',
      send_method: sendMethod,
    }])
    if (error) {
      console.error('logMessage: insert failed', to, messageType, error)
    }
  } catch (err) {
    console.error('logMessage: unexpected error', to, messageType, err)
  }
}

// Free-form text — unchanged behavior from before, plus logging.
// options: { messageType, userId } — both optional, used for logging only.
export async function sendMessage(to, message, options = {}) {
  const { messageType = 'reply', userId = null } = options

  const response = await fetch(META_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${META_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body: message },
    }),
  })

  if (!response.ok) {
    const errorBody = await response.text()
    console.error('Meta send failed (text):', response.status, errorBody, { to, messageType })
    return { ok: false }
  }

  await logMessage({ to, userId, messageType, sendMethod: 'text' })
  return { ok: true }
}

// Approved WhatsApp Message Template. components follows Meta's format:
// [{ type: 'body', parameters: [{ type: 'text', text: '...' }, ...] }]
export async function sendTemplateMessage(to, { templateName, language = 'en', components = [], messageType = 'general', userId = null }) {
  if (!templateName) {
    console.error('sendTemplateMessage: missing templateName', { to, messageType })
    return { ok: false }
  }

  const response = await fetch(META_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${META_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: templateName,
        language: { code: language },
        components,
      },
    }),
  })

  if (!response.ok) {
    const errorBody = await response.text()
    console.error('Meta send failed (template):', response.status, errorBody, { to, templateName, messageType })
    return { ok: false }
  }

  await logMessage({ to, userId, messageType, sendMethod: 'template' })
  return { ok: true }
}

// Convenience wrapper for proactive sends (Temi messaging first).
// Picks text if the window is open (cheaper pre-Oct-1, same cost after),
// otherwise falls back to the approved template so delivery doesn't
// silently fail. If no template is registered yet for messageType/language,
// logs loudly and still attempts text as a last resort (better a possible
// delivery failure that's visible in logs than a guaranteed silent one).
export async function sendProactiveMessage(to, {
  userId = null,
  lastInboundAt = null,
  messageType,
  textBody,
  language = 'en',
  templateComponents = [],
}) {
  if (isWindowOpen(lastInboundAt)) {
    return sendMessage(to, textBody, { messageType, userId })
  }

  const templateName = TEMPLATE_NAMES[messageType]?.[language] || TEMPLATE_NAMES[messageType]?.en

  if (!templateName) {
    console.error('sendProactiveMessage: window closed but no approved template registered — attempting text anyway, delivery likely to fail', { to, messageType, language })
    return sendMessage(to, textBody, { messageType, userId })
  }

  return sendTemplateMessage(to, { templateName, language, components: templateComponents, messageType, userId })
}
