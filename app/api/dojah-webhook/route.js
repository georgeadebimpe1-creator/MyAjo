import { NextResponse } from 'next/server'
import { supabaseAdmin } from '../../lib/supabase'
// Dojah calls this automatically once verification is complete.
// This is the trustworthy source of truth — not the widget's onSuccess
// in the browser, which only tells the TRADER it succeeded, not us.
export async function POST(request) {
  try {
    const payload = await request.json()
    console.log('Dojah webhook payload:', JSON.stringify(payload))

    // The trader's WhatsApp number, passed through as metadata when we
    // opened the widget, comes back to us here so we know whose result this is.
    const whatsapp = payload?.metadata?.user_id
    if (!whatsapp) {
      console.error('Dojah webhook: no whatsapp number in metadata', JSON.stringify(payload))
      return new NextResponse('OK', { status: 200 })
    }

    if (!supabaseAdmin) {
      // SUPABASE_SERVICE_ROLE_KEY isn't set in this environment — writes
      // would silently fail under RLS using the anon client, so fail loudly
      // instead of repeating the old silent-failure bug.
      console.error('Dojah webhook: SUPABASE_SERVICE_ROLE_KEY is not set, cannot write to users table')
      return new NextResponse('Server misconfigured', { status: 500 })
    }

    // FIX 1: the real payload sends status as a BOOLEAN (`status: true`),
    // and verification_status as "Completed" with a capital C — neither
    // matched the old string-lowercase check, so `verified` was always
    // false, even for genuinely successful verifications.
    const verified =
      payload?.status === true ||
      payload?.verification_status?.toLowerCase() === 'completed'

    // FIX 2: government_data actually lives at
    // payload.data.government_data.data.bvn.entity — three levels
    // deeper than the old code assumed. Different id_type values (NIN,
    // passport, etc.) may nest under a different key than `bvn`, so we
    // grab whichever entity is actually present under `data`.
    const bvnEntityContainer = payload?.data?.government_data?.data
    const entity = bvnEntityContainer ? Object.values(bvnEntityContainer)[0]?.entity : null

    if (verified && entity) {
      const fullName =
        entity.first_name && entity.last_name
          ? `${entity.first_name} ${entity.last_name}`.trim()
          : entity.first_name || entity.last_name || null

      // FIX 3: check the Supabase response for an error instead of
      // discarding it. Supabase does NOT throw on RLS-blocked writes —
      // it returns { error }, which the old code never inspected, so a
      // blocked write silently looked identical to a successful one.
      const { error } = await supabaseAdmin
        .from('users')
        .upsert(
          {
            whatsapp_number: whatsapp,
            phone_number: whatsapp,
            kyc_status: 'verified',
            full_name: fullName,
            date_of_birth: entity.date_of_birth || null,
            gender: entity.gender || null,
            residential_address: entity.residential_address || null,
          },
          { onConflict: 'whatsapp_number' }
        )

      if (error) {
        console.error('Dojah webhook: Supabase upsert failed (verified)', whatsapp, error)
        return new NextResponse('Error', { status: 500 })
      }
    } else {
      const { error } = await supabaseAdmin
        .from('users')
        .upsert(
          { whatsapp_number: whatsapp, phone_number: whatsapp, kyc_status: 'failed' },
          { onConflict: 'whatsapp_number' }
        )

      if (error) {
        console.error('Dojah webhook: Supabase upsert failed (failed-status)', whatsapp, error)
        return new NextResponse('Error', { status: 500 })
      }
    }

    return new NextResponse('OK', { status: 200 })
  } catch (error) {
    console.error('Dojah webhook error:', error)
    return new NextResponse('Error', { status: 500 })
  }
}
