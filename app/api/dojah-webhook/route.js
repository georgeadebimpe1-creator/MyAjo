import { NextResponse } from 'next/server'
import { supabaseAdmin } from '../../lib/supabase'
import { sendMessage } from '../../lib/whatsapp'
import { updateSession, clearSession, getSession } from '../../lib/session'
import { getActiveCycle, getBalanceSummary } from '../../lib/savings'
import { applyVerifiedIdentity } from '../../lib/dojah'
import { getUserForBankChange, BANK_CHANGE_MAX_FAILED_CHECKS } from '../../lib/bankChange'
import { getMessage } from '../../lib/messages'
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

    // CHANGEBANK: a trader who asked to change their payout bank is
    // re-verifying with the same widget. This result must NEVER go
    // through the normal path below: that path rewrites the trader's
    // identity row and, on a failed check, marks them kyc 'failed'
    // (which would lock a good, already-verified trader out). Here we
    // only compare the BVN to the one already on file and move the
    // conversation along.
    const session = await getSession(whatsapp)
    if (session?.step === 'awaiting_bankchange_verification') {
      const temp = session.temp_data || {}
      const lang = temp.language || 'en'
      const user = await getUserForBankChange(whatsapp)
      const bvnMatches = !!(verified && entity?.bvn && user?.bvn && String(entity.bvn) === String(user.bvn))

      if (bvnMatches) {
        await updateSession(whatsapp, 'bankchange_details', { language: lang, verifiedAt: Date.now() })
        await sendMessage(whatsapp, getMessage('bankchange_verified', lang))
        return new NextResponse('OK', { status: 200 })
      }

      const failedChecks = (temp.failedChecks || 0) + 1
      console.log('Dojah webhook: CHANGEBANK identity check did not pass', whatsapp, { verified, hadBvn: !!entity?.bvn, failedChecks })
      if (failedChecks >= BANK_CHANGE_MAX_FAILED_CHECKS) {
        await clearSession(whatsapp)
        await sendMessage(whatsapp, getMessage('bankchange_too_many', lang))
      } else {
        await updateSession(whatsapp, 'awaiting_bankchange_verification', { ...temp, failedChecks })
        await sendMessage(whatsapp, getMessage('bankchange_verify_failed', lang, { attemptsLeft: BANK_CHANGE_MAX_FAILED_CHECKS - failedChecks }))
      }
      return new NextResponse('OK', { status: 200 })
    }

    if (verified && entity) {
      // FIX 4 (NEW): the BVN itself was never being saved, even though
      // the `users.bvn` column exists — nothing wrote to it. This is
      // required before an Anchor customer/deposit account can be
      // provisioned. UNCONFIRMED FIELD NAME: assuming `entity.bvn` —
      // check a real logged payload (this route already logs the raw
      // payload above) to confirm that's the right key before trusting
      // it in production. If it's actually the key of `data` itself
      // (e.g. Object.keys(bvnEntityContainer)[0]) rather than a field
      // inside `entity`, this needs a one-line adjustment.
      //
      // REFACTORED: the actual Supabase write (including the
      // BVN-migration check for a trader who changed WhatsApp numbers)
      // now lives in lib/dojah.js's applyVerifiedIdentity(), shared
      // with the MANUALVERIFY path in app/api/webhook/route.js, so the
      // two paths can't quietly drift apart on what "verified" means.
      let targetUserId, fullName
      try {
        const result = await applyVerifiedIdentity(supabaseAdmin, whatsapp, entity)
        targetUserId = result.targetUserId
        fullName = result.fullName
        if (result.migratedFromWhatsapp) {
          console.log('Dojah webhook: BVN matched an existing trader under a different WhatsApp number — migrating their identity to the new number instead of creating a new row', {
            oldWhatsapp: result.migratedFromWhatsapp,
            newWhatsapp: whatsapp,
            userId: targetUserId,
          })
        }
      } catch (writeErr) {
        console.error('Dojah webhook: applyVerifiedIdentity failed', whatsapp, writeErr)
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
              `Welcome back${fullName ? `, ${fullName}` : ''}! We've reconnected your MyAjo account to this number.\n\nYou have an active savings cycle running — Day ${s.cycleDayNumber} of 30, N${s.totalSaved.toLocaleString()} saved so far.\n\nType BALANCE anytime to check your progress, PAID to confirm today's transfer, or WITHDRAW followed by an amount.\n\nYour payout bank account stays exactly as it was first set up, so anything bank-related you typed just now was not used. To change your bank account, contact support at hello@myajo.com.ng.`
            )
          } else {
            await updateSession(whatsapp, 'new_cycle_amount', {})
            await sendMessage(
              whatsapp,
              `Welcome back${fullName ? `, ${fullName}` : ''}! We've reconnected your MyAjo account to this number.\n\nReady to start a new 30-day savings cycle. How much would you like to save daily this time? (N1,000 - N10,000)\n\nYour payout bank account stays exactly as it was first set up, so anything bank-related you typed just now was not used. To change your bank account, contact support at hello@myajo.com.ng.`
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
