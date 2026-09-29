// app/lib/dojah.js
//
// Direct server-side calls to Dojah's API — separate from the hosted
// widget flow in app/verify/page.js and the async result it reports to
// app/api/dojah-webhook/route.js.
//
// This file exists for ONE case: a trader who cannot complete the
// widget (broken link, no working camera on their phone, connectivity
// too poor to load it) and is being verified manually by support
// instead, by phone, via the MANUALVERIFY flow in
// app/api/webhook/route.js. Same BVN + selfie match Dojah's widget
// does — this just calls Dojah directly with a selfie photo the
// trader sends over WhatsApp, instead of one taken inside Dojah's own
// widget page.
//
// SECURITY NOTE: this bypasses the widget's own liveness checks
// (blink detection, etc.) — Dojah is only comparing a still photo
// against the BVN's photo on file. That is a deliberate trade-off for
// traders who genuinely have no other way to verify, walked through
// by a human on a call, not a general substitute for the widget or a
// self-serve shortcut — this is why MANUALVERIFY is not listed in
// HELP.
//
// Endpoint reference: https://docs.dojah.io/api-reference/biometrics-liveness/bvn-nin-selfie

const DOJAH_API_URL = process.env.DOJAH_API_URL || 'https://sandbox.dojah.io'
// Reuses the same App ID the widget already uses client-side (App ID
// is a public identifier per Dojah's own docs, not a secret) — no new
// var needed for this half of the credentials.
const DOJAH_APP_ID = process.env.NEXT_PUBLIC_DOJAH_APP_ID
// This one IS secret and does NOT exist yet anywhere in the app — the
// widget only ever needed the public key. Get this from the Dojah
// dashboard (Developers → Configuration → My Apps → Secret Key) and
// add it as DOJAH_SECRET_KEY in Vercel before this can work. NEVER
// expose this with a NEXT_PUBLIC_ prefix.
const DOJAH_SECRET_KEY = process.env.DOJAH_SECRET_KEY

// Calls Dojah's direct BVN + selfie match endpoint.
//
// selfieImageBase64 must be the RAW base64 buffer, no
// "data:image/jpeg;base64," prefix — Dojah's docs are explicit that
// prefix must be stripped before sending. lib/whatsapp.js's
// downloadWhatsappMediaAsBase64() already returns it in that form.
//
// Returns { matched, entity } on a completed call. `matched` is
// Dojah's OWN selfie_verification.match boolean, not a confidence
// threshold re-derived here — Dojah's documented cutoff differs
// across their different selfie-match endpoints (80 for some, 90 for
// this one), so trust their boolean rather than risk using the wrong
// number.
//
// Throws on a network/API-level failure (bad BVN format, Dojah down,
// wrong/missing credentials, insufficient wallet balance in
// production, etc.) — the caller decides how to message the trader.
export async function verifyBvnWithSelfie({ bvn, selfieImageBase64 }) {
  if (!DOJAH_APP_ID || !DOJAH_SECRET_KEY) {
    throw new Error('Dojah direct-API credentials are not configured (need NEXT_PUBLIC_DOJAH_APP_ID and DOJAH_SECRET_KEY)')
  }

  const response = await fetch(`${DOJAH_API_URL}/api/v1/kyc/bvn/verify`, {
    method: 'POST',
    headers: {
      'AppId': DOJAH_APP_ID,
      // Dojah's docs are explicit: this is the raw secret key, NOT
      // "Bearer <key>" — a Bearer prefix here fails auth silently.
      'Authorization': DOJAH_SECRET_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ bvn, selfie_image: selfieImageBase64 }),
  })

  const data = await response.json().catch(() => null)

  if (!response.ok || !data?.entity) {
    const err = new Error(`Dojah BVN+selfie verify failed (${response.status})`)
    err.status = response.status
    err.dojahDetail = data
    throw err
  }

  const entity = data.entity
  const matched = entity?.selfie_verification?.match === true

  return { matched, entity }
}

// Shared field-mapping: turns a Dojah `entity` object (same shape
// whether it came from the widget's webhook or the direct API above)
// into the Supabase write that marks a trader verified. Used by BOTH
// app/api/dojah-webhook/route.js (widget path) and the manual-selfie
// path in app/api/webhook/route.js, so the two paths can never quietly
// drift apart on what "verified" means in the database — see the
// engineering note about parallel-thread regressions.
//
// Pass in supabaseAdmin from the caller rather than importing it here,
// so this file has no Supabase dependency of its own to keep in sync.
//
// Returns { targetUserId, migratedFromWhatsapp, fullName } —
// targetUserId is set (and migratedFromWhatsapp non-null) only when
// this BVN already belonged to a DIFFERENT existing row, meaning this
// is a returning trader reconnecting under a new WhatsApp number, not
// a brand-new signup. The caller decides what to message them about
// that; this function only handles the data write.
export async function applyVerifiedIdentity(supabaseAdmin, whatsapp, entity) {
  const fullName =
    entity.first_name && entity.last_name
      ? `${entity.first_name} ${entity.last_name}`.trim()
      : entity.first_name || entity.last_name || null

  const bvn = entity.bvn || null

  let targetUserId = null
  let migratedFromWhatsapp = null

  if (bvn) {
    const { data: existingByBvn, error: bvnLookupErr } = await supabaseAdmin
      .from('users')
      .select('id, whatsapp_number')
      .eq('bvn', bvn)
      .neq('whatsapp_number', whatsapp)
      .maybeSingle()

    if (bvnLookupErr) {
      console.error('applyVerifiedIdentity: BVN lookup failed, falling back to whatsapp_number upsert — a duplicate row is possible, check manually', whatsapp, bvnLookupErr)
    } else if (existingByBvn) {
      targetUserId = existingByBvn.id
      migratedFromWhatsapp = existingByBvn.whatsapp_number
    }
  }

  const verifiedFields = {
    whatsapp_number: whatsapp,
    phone_number: whatsapp,
    kyc_status: 'verified',
    full_name: fullName,
    date_of_birth: entity.date_of_birth || null,
    gender: entity.gender || null,
    residential_address: entity.residential_address || null,
    bvn: bvn,
  }

  const { error } = targetUserId
    ? await supabaseAdmin.from('users').update(verifiedFields).eq('id', targetUserId)
    : await supabaseAdmin.from('users').upsert(verifiedFields, { onConflict: 'whatsapp_number' })

  if (error) {
    console.error('applyVerifiedIdentity: Supabase write failed', whatsapp, error)
    throw new Error('Could not save your verification. Please contact support.')
  }

  if (!bvn) {
    // Don't fail the caller over this — verification still succeeded
    // and the trader shouldn't be stuck — but this needs eyes on it,
    // since Anchor provisioning will fail without a BVN on file.
    console.error('applyVerifiedIdentity: verified but no BVN captured — check entity shape', whatsapp)
  }

  return { targetUserId, migratedFromWhatsapp, fullName }
}
