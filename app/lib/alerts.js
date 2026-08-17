// app/lib/alerts.js
//
// Sends an alert to you (the admin) when something needs a human —
// right now, specifically: a payout succeeded but the database write
// that should have recorded it failed (see withdrawal.js). Money has
// already moved in that case; this is the notification that stops it
// from sitting silently wrong in Supabase.
//
// Sends on BOTH WhatsApp and email, attempted independently — if one
// channel fails (bad credentials, network issue) the other still gets
// tried. This function must NEVER throw: it's called from inside
// withdrawal.js after a payout has already succeeded, and an alerting
// bug should never be able to break that response back to the trader.
//
// Requires these env vars in Vercel:
//   GMAIL_USER            - the Gmail address sending the alert
//   GMAIL_APP_PASSWORD    - a Gmail App Password (not the login password —
//                            requires 2-Step Verification enabled on that
//                            Gmail account first, then generated under
//                            Google Account > Security > App Passwords)
//   ADMIN_ALERT_EMAIL     - where the email alert is sent
//   ADMIN_WHATSAPP_NUMBER - where the WhatsApp alert is sent (same
//                            format as other WhatsApp numbers in this app)

import nodemailer from 'nodemailer'
import { sendMessage } from './whatsapp'

const GMAIL_USER = process.env.GMAIL_USER
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD
const ADMIN_ALERT_EMAIL = process.env.ADMIN_ALERT_EMAIL
const ADMIN_WHATSAPP_NUMBER = process.env.ADMIN_WHATSAPP_NUMBER

export async function sendAdminAlert(subject, message) {
  // allSettled, not all/await in sequence — one channel's failure must
  // never stop the other channel from being attempted.
  await Promise.allSettled([
    sendWhatsAppAlert(subject, message),
    sendEmailAlert(subject, message),
  ])
}

async function sendWhatsAppAlert(subject, message) {
  if (!ADMIN_WHATSAPP_NUMBER) {
    console.error('sendAdminAlert: ADMIN_WHATSAPP_NUMBER is not set — skipping WhatsApp alert')
    return
  }
  try {
    await sendMessage(ADMIN_WHATSAPP_NUMBER, `MyAjo ALERT: ${subject}\n\n${message}`)
  } catch (err) {
    // Logged, not thrown — see file header.
    console.error('sendAdminAlert: WhatsApp alert failed to send', err)
  }
}

async function sendEmailAlert(subject, message) {
  if (!GMAIL_USER || !GMAIL_APP_PASSWORD || !ADMIN_ALERT_EMAIL) {
    console.error('sendAdminAlert: Gmail env vars are not fully set — skipping email alert')
    return
  }
  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
    })

    await transporter.sendMail({
      from: GMAIL_USER,
      to: ADMIN_ALERT_EMAIL,
      subject: `MyAjo ALERT: ${subject}`,
      text: message,
    })
  } catch (err) {
    console.error('sendAdminAlert: email alert failed to send', err)
  }
}
