import { NextResponse } from 'next/server'
import { supabaseAdmin } from '../../lib/supabase'
import { sendMessage } from '../../lib/whatsapp'
import { updateSession, clearSession } from '../../lib/session'
import { getActiveCycle, getBalanceSummary } from '../../lib/savings'
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

      // FIX 4 (NEW): the BVN itself was never being saved, even though
      // the `users.bvn` column exists — nothing wrote to it. This is
      // required before an Anchor customer/deposit account can be
      // provisioned. UNCONFIRMED FIELD NAME: assuming `entity.bvn` —
      // check a real logged payload (this route already logs the raw
      // payload above) to confirm that's the right key before trusting
      // it in production. If it's actually the key of `data` itself
      // (e.g. Object.keys(bvnEntityContainer)[0]) rather than a field
      // inside `entity`, this needs a one-line adjustment.
      const bvn = entity.bvn || null

      // A trader who changed their WhatsApp number (lost phone, SIM
      // swap, new line) shows up here looking exactly like a brand-new
      // signup — a whatsapp_number Temi has never seen before. Without
      // this check, the upsert below (keyed on whatsapp_number) would
      // create a SECOND users row for the same real person, completely
      // disconnected from their original row — which is what still
      // holds their actual cycle, contribution history, and Anchor
      // account. Their real savings would still exist, just invisible
      // to them under the new number. This checks BVN first: if it
      // already belongs to a different row, that's the same trader,
      // and the fix is to update THAT row's whatsapp_number, not to
      // create a new identity.
      let targetUserId = null
      if (bvn) {
        const { data: existingByBvn, error: bvnLookupErr } = await supabaseAdmin
          .from('users')
          .select('id, whatsapp_number')
          .eq('bvn', bvn)
          .neq('whatsapp_number', whatsapp)
          .maybeSingle()

        if (bvnLookupErr) {
          console.error('Dojah webhook: BVN lookup failed, falling back to whatsapp_number upsert — a duplicate row is possible, check manually', whatsapp, bvnLookupErr)
        } else if (existingByBvn) {
          targetUserId = existingByBvn.id
          console.log('Dojah webhook: BVN matched an existing trader under a different WhatsApp number — migrating their identity to the new number instead of creating a new row', {
            oldWhatsapp: existingByBvn.whatsapp_number,
            newWhatsapp: whatsapp,
            userId: targetUserId,
          })
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

      // FIX 3: check the Supabase response for an error instead of
      // discarding it. Supabase does NOT throw on RLS-blocked writes —
      // it returns { error }, which the old code never inspected, so a
      // blocked write silently looked identical to a successful one.
      const { error } = targetUserId
        ? await supabaseAdmin.from('users').update(verifiedFields).eq('id', targetUserId)
        : await supabaseAdmin.from('users').upsert(verifiedFields, { onConflict: 'whatsapp_number' })

      if (error) {
        console.error('Dojah webhook: Supabase upsert failed (verified)', whatsapp, error)
        return new NextResponse('Error', { status: 500 })
      }

      // RECONNECT: this verification matched an existing trader under a
      // different WhatsApp number — their identity, cycle history, and
      // Anchor account are now linked to THIS number. Message them
      // directly rather than waiting for them to type something first
      // (they may still be sitting on the "reply with your details"
      // onboarding text from before this webhook resolved — this
      // supersedes that; no other details need re-entering). Whether
      // they land on BALANCE or a fresh daily-amount prompt depends on
      // whether they have a cycle running right now.
      if (targetUserId) {
        try {
          const activeCycle = await getActiveCycle(targetUserId)
          if (activeCycle) {
            const s = getBalanceSummary(activeCycle)
            await clearSession(whatsapp)
            await sendMessage(
              whatsapp,
              `Welcome back${fullName ? `, ${fullName}` : ''}! We've reconnected your MyAjo account to this number.\n\nYou have an active savings cycle running — Day ${s.cycleDayNumber} of 30, N${s.totalSaved.toLocaleString()} saved so far.\n\nType BALANCE anytime to check your progress, PAID to confirm today's transfer, or WITHDRAW followed by an amount.`
            )
          } else {
            await updateSession(whatsapp, 'new_cycle_amount', {})
            await sendMessage(
              whatsapp,
              `Welcome back${fullName ? `, ${fullName}` : ''}! We've reconnected your MyAjo account to this number.\n\nReady to start a new 30-day savings cycle. How much would you like to save daily this time? (N1,000 - N10,000)`
            )
          }
        } catch (reconnectMsgErr) {
          // The identity migration itself already succeeded and was
          // written to the database above — this only affects whether
          // the trader got proactively messaged about it. Not fatal:
          // worth logging, but don't fail the whole webhook over a
          // notification failure when the actual data write succeeded.
          console.error('Dojah webhook: reconnect succeeded but the welcome-back message failed', whatsapp, targetUserId, reconnectMsgErr)
        }
      }

      if (!bvn) {
        // Don't fail the webhook over this — verification still succeeded
        // and the trader shouldn't be stuck — but this needs eyes on it,
        // since Anchor provisioning will fail without a BVN on file.
        console.error('Dojah webhook: verified but no BVN captured — check payload shape', whatsapp)
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
