import { NextResponse } from 'next/server'
import { supabase } from '../../lib/supabase'
import { sendMessage } from '../../lib/whatsapp'
import { getMessage, LANGUAGES, LANGUAGE_SELECT_MESSAGE } from '../../lib/messages'
import { quoteWithdrawalForCycle, processWithdrawal } from '../../lib/withdrawal'
import { anchorPayout } from '../../lib/payout'
import { getSession, updateSession, clearSession } from '../../lib/session'
import { getUserByWhatsapp, createOrUpdateAccount, freezeAccount, provisionAnchorAccount, checkAndFinalizeIfApproved, verifyAndLinkBankAccount, verifyAndLinkResolvedBank, updateUserLanguage } from '../../lib/accounts'
import { getActiveCycle, startCycle, getBalanceSummary, getTodaysContribution, projectPlan, validateDailyAmount, calculateCommission, getCycleDayNumber } from '../../lib/savings'

const META_VERIFY_TOKEN = process.env.META_VERIFY_TOKEN
const APP_URL = process.env.APP_URL || 'https://my-ajo-ten.vercel.app'

// NOTE: everything below is WhatsApp-specific — reading the trader's raw
// text, matching commands, and writing back plain-text replies. All the
// actual account/savings work now lives in lib/session.js, lib/accounts.js,
// and lib/savings.js, and can be called the same way from any future
// channel without touching this file.
//
// UNITS: every amount in this file — trader input, session data, database
// values, and WhatsApp text — is in NAIRA, matching lib/savings.js and the
// COMMISSION_TIERS table. Kobo only matters at the point a request is
// actually built for Anchor's API (not in this file) — that is the one
// place a x100 conversion should happen.
//
// LANGUAGE: every conversation now opens with LANGUAGE_SELECT_MESSAGE
// (see lib/messages.js) before anything else — including for returning
// traders, by design, so they can switch language any time they start a
// fresh interaction. Once chosen, the code is carried in session.temp_data
// as `language` and threaded through every updateSession() call for the
// rest of that flow, so it survives step changes. It's written
// permanently to the trader's user record at account creation
// (createOrUpdateAccount, in lib/accounts.js), matching the `language`
// column's own comment in Supabase, and updated again on every later
// cycle in case they picked differently that time.
//
// As of this pass, EVERY reply in this file that isn't a WhatsApp
// Message Template (see PHASE 1B note in lib/messages.js) is routed
// through getMessage() with the trader's chosen language — see the
// translation-confidence note at the top of lib/messages.js before
// treating any of it as launch-ready; only the original Hausa Phase 1
// content has been through native-speaker review so far.

function getLang(temp) {
  return (temp && temp.language) || 'en'
}

// Parses the trader's one-shot onboarding reply: full name, email,
// residential address, bank name, account number, daily amount — each
// expected on its own line. Blank lines are ignored so a trailing
// newline doesn't break the count.
//
// Address is asked for as "Street, City, State" on one line so it can
// be split into the structured shape Anchor's customer-creation API
// requires (addressLine_1/city/state/country) without adding a
// separate onboarding step. Date of birth and gender are NOT collected
// here — those come from Dojah's BVN lookup automatically once the
// trader completes verification, and asking for them again would just
// be typed data Anchor re-checks against the BVN record anyway.
//
// This reply format prompt itself stays English-only regardless of the
// trader's chosen language for now (see lib/messages.js phase notes) —
// only the error explanations below are localized via getMessage.
function parseOnboardingDetails(text, lang) {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0)

  if (lines.length !== 6) {
    return {
      valid: false,
      reason: getMessage('onboarding_details_missing', lang),
    }
  }

  const [fullName, email, addressRaw, bankName, accountNumberRaw, amountRaw] = lines
  const accountNumber = accountNumberRaw.replace(/\s/g, '')

  if (!email.includes('@') || !email.includes('.')) {
    return { valid: false, reason: getMessage('onboarding_details_missing', lang) }
  }

  const addressParts = addressRaw.split(',').map(p => p.trim()).filter(p => p.length > 0)
  if (addressParts.length < 2) {
    return {
      valid: false,
      reason: getMessage('onboarding_details_missing', lang),
    }
  }
  const address = {
    addressLine_1: addressParts[0],
    city: addressParts.length >= 3 ? addressParts[1] : '',
    state: addressParts[addressParts.length - 1],
    postalCode: '',
    country: 'NG',
  }
  const addressDisplay = addressParts.join(', ')

  if (accountNumber.length < 10 || !/^\d+$/.test(accountNumber)) {
    return { valid: false, reason: getMessage('onboarding_details_missing', lang) }
  }

  const dailyAmount = parseFloat(amountRaw.replace(/,/g, ''))
  const { valid, reason } = validateDailyAmount(dailyAmount)
  if (!valid) {
    // reason comes from lib/savings.js and stays English-only for now —
    // that file has no translation layer yet, flagged as a known gap.
    return { valid: false, reason: `${reason}\n\nPlease resend all 6 details with a valid amount.` }
  }

  return {
    valid: true,
    data: {
      full_name: fullName,
      email,
      address,
      address_display: addressDisplay,
      bank_name: bankName,
      bank_account_number: accountNumber,
      daily_amount: dailyAmount,
    },
  }
}

async function beginNewSavingsPlan(whatsapp, lang) {
  const existingUser = await getUserByWhatsapp(whatsapp)

  if (existingUser) {
    const activeCycle = await getActiveCycle(existingUser.id)
    if (activeCycle) {
      await clearSession(whatsapp)
      return getMessage('active_cycle_exists', lang)
    }

    // Returning trader who already completed (or withdrew from) a prior
    // cycle — they're already KYC-verified and already have a deposit
    // account with our banking partner from last time. FIX: this used
    // to fall straight through to the full from-scratch onboarding
    // questionnaire below (name, email, address, bank, re-verification)
    // for every returning trader, with no way to skip it — even though
    // none of that has changed and provisionAnchorAccount() already
    // knew how to short-circuit for exactly this case. Now a verified
    // returning trader is just asked how much they want to save this
    // time, and their new cycle starts against their existing account.
    if (existingUser.kyc_status === 'verified' && existingUser.anchor_account_id && existingUser.anchor_account_number) {
      await updateSession(whatsapp, 'new_cycle_amount', { language: lang })
      return getMessage('returning_trader_new_cycle', lang, { name: existingUser.full_name })
    }
  }

  await updateSession(whatsapp, 'onboarding', { language: lang })
  const verifyLink = `${APP_URL}/verify?ref=${whatsapp}`
  return getMessage('onboarding_intro', lang, { verifyLink })
}

function buildPlanMessage(temp, lang) {
  const plan = projectPlan(temp.daily_amount)
  return getMessage('plan_message', lang, {
    dailyAmount: temp.daily_amount.toLocaleString(),
    totalSavings: plan.totalSavings.toLocaleString(),
    commission: plan.commission.toLocaleString(),
    payout: plan.payout.toLocaleString(),
    bankName: temp.bank_name,
    accountNumber: temp.bank_account_number,
    fullName: temp.full_name,
    email: temp.email,
    address: temp.address_display,
  })
}

async function handleMessage(from, body) {
  const whatsapp = from.startsWith('234') ? '0' + from.slice(3) : from
  const message = body.trim()
  const upper = message.toUpperCase()
  const session = await getSession(whatsapp)
  const step = session ? session.step : 'welcome'
  const temp = session ? session.temp_data : {}

  // Every fresh interaction — no session at all, or an explicit
  // MENU/START/HI/HELLO — opens with the language question, even for
  // returning traders. This is deliberate: it's the only chance someone
  // gets to switch language later, since we don't re-ask mid-flow.
  if (upper === 'MENU' || upper === 'START' || upper === 'HI' || upper === 'HELLO' || !session) {
    await updateSession(whatsapp, 'select_language', {})
    return LANGUAGE_SELECT_MESSAGE
  }

  if (step === 'select_language') {
    const lang = LANGUAGES[message]
    if (!lang) {
      return `${LANGUAGE_SELECT_MESSAGE}\n\n(Please reply with just the number: 1, 2, 3, or 4.)`
    }
    await updateSession(whatsapp, 'main_menu', { language: lang })
    // Persist for a RETURNING trader too, not just this session. A
    // brand-new signup's language gets written once, correctly, later —
    // at account creation in createOrUpdateAccount() — so this only
    // needs to act when a users row already exists.
    const existingUser = await getUserByWhatsapp(whatsapp)
    if (existingUser) {
      await updateUserLanguage(whatsapp, lang)
    }
    return getMessage('welcome', lang)
  }

  if (upper === 'RECONNECT') {
    // For a trader messaging from a number Temi doesn't recognize —
    // most commonly a phone/SIM change. Sends them through the exact
    // same Dojah verify flow as fresh onboarding, but tied to THIS
    // number. dojah-webhook/route.js checks the verified BVN against
    // existing users: if it matches a different existing row, that's
    // the same trader, and their identity (cycle, history, Anchor
    // account) gets reconnected to this number automatically — no BVN
    // typed into chat, no other details re-entered. If the BVN turns
    // out to be genuinely new, it's treated as a normal first-time
    // verification and they're guided into full onboarding from there.
    const lang = getLang(temp)
    await updateSession(whatsapp, 'awaiting_reconnect_verification', { language: lang })
    const verifyLink = `${APP_URL}/verify?ref=${whatsapp}`
    return getMessage('reconnect_prompt', lang, { verifyLink })
  }

  if (step === 'awaiting_reconnect_verification') {
    return getMessage('reconnect_waiting', getLang(temp), { verifyLink: `${APP_URL}/verify?ref=${whatsapp}` })
  }

  if (step === 'main_menu') {
    const lang = getLang(temp)

    if (message === '1') {
      return await beginNewSavingsPlan(whatsapp, lang)
    }

    if (message === '2') {
      await updateSession(whatsapp, 'check_balance', { language: lang })
      const user = await getUserByWhatsapp(whatsapp)

      if (!user) {
        // FIX (2026-08-24): this used to clearSession() before telling
        // the trader to "type 1" — clearing the session means step
        // becomes 'welcome' next message, not 'main_menu', so the "1"
        // this message just asked for falls through to "I did not
        // understand" instead of being recognized. Reproduced live.
        await updateSession(whatsapp, 'main_menu', { language: lang })
        return getMessage('no_account_found', lang)
      }

      const cycle = await getActiveCycle(user.id)
      if (!cycle) {
        await updateSession(whatsapp, 'main_menu', { language: lang })
        return getMessage('no_active_cycle_balance', lang)
      }

      const s = getBalanceSummary(cycle)
      await clearSession(whatsapp)
      return getMessage('balance', lang, {
        name: user.full_name,
        saved: s.totalSaved.toLocaleString(),
        daysContributed: s.daysContributed,
        progressBar: s.progressBar,
        progressPercent: s.progressPercent,
        expectedTotal: s.expectedTotal.toLocaleString(),
        commission: s.commission.toLocaleString(),
        expectedPayout: s.expectedPayout.toLocaleString(),
        withdrawLine: s.canWithdraw
          ? `\n\nYou can withdraw anytime. Type WITHDRAW followed by an amount.`
          : `\n\nWithdrawals unlock on day 10 (${10 - s.cycleDayNumber} day${(10 - s.cycleDayNumber) === 1 ? '' : 's'} to go).`,
      })
    }

    if (message === '3') {
      await updateSession(whatsapp, 'main_menu', { language: lang })
      const exampleCommission = calculateCommission(1000)
      const examplePayout = 30000 - exampleCommission
      return getMessage('how_it_works', lang, {
        exampleCommission: exampleCommission.toLocaleString(),
        examplePayout: examplePayout.toLocaleString(),
      })
    }

    if (message === '4') {
      await clearSession(whatsapp)
      return getMessage('support_message', lang)
    }

    return getMessage('main_menu_invalid', lang)
  }

  if (step === 'new_cycle_amount') {
    const lang = getLang(temp)
    const dailyAmount = parseFloat(message.replace(/,/g, ''))
    const { valid, reason } = validateDailyAmount(dailyAmount)
    if (!valid) {
      // reason comes from lib/savings.js and stays English-only for now.
      return `${reason}\n\n${getMessage('new_cycle_amount_prompt', lang)}`
    }

    const user = await getUserByWhatsapp(whatsapp)
    if (!user || !user.anchor_account_number) {
      console.error('new_cycle_amount: returning user missing account details at cycle start', whatsapp)
      await clearSession(whatsapp)
      return getMessage('new_cycle_account_error', lang)
    }

    await startCycle(user.id, dailyAmount)
    await clearSession(whatsapp)
    return getMessage('cycle_activated', lang, {
      name: user.full_name,
      dailyAmount: dailyAmount.toLocaleString(),
      accountNumber: user.anchor_account_number,
      isNew: false,
    })
  }

  if (step === 'onboarding') {
    const lang = getLang(temp)

    if (upper === 'DONE') {
      const user = await getUserByWhatsapp(whatsapp)

      if (!temp.full_name) {
        return getMessage('onboarding_details_missing', lang)
      }

      if (!user || user.kyc_status !== 'verified') {
        if (user && user.kyc_status === 'failed') {
          const verifyLink = `${APP_URL}/verify?ref=${whatsapp}`
          return getMessage('verification_failed', lang, { verifyLink })
        }
        return getMessage('still_checking_verification', lang)
      }

      if (!temp.bank_verified) {
        let bankResult
        try {
          bankResult = await verifyAndLinkBankAccount(user.id, temp.bank_name, temp.bank_account_number)
        } catch (err) {
          console.error('DONE: bank verification threw unexpectedly', whatsapp, err)
          return getMessage('bank_verify_error', lang, { err: err.message })
        }

        if (bankResult.retype) {
          return getMessage('bank_not_found', lang, { bankName: temp.bank_name })
        }

        if (bankResult.needsSelection) {
          const numbered = bankResult.candidates.map((c, i) => `${i + 1}. ${c.name}`).join('\n')
          await updateSession(whatsapp, 'select_bank', {
            ...temp,
            userId: user.id,
            bankCandidates: bankResult.candidates,
          })
          return getMessage('bank_selection', lang, { bankName: temp.bank_name, numbered })
        }

        temp.bank_name = bankResult.bankName
        temp.bank_verified = true
      }

      await updateSession(whatsapp, 'confirm_plan', temp)
      return buildPlanMessage(temp, lang)
    }

    const parsed = parseOnboardingDetails(message, lang)
    if (!parsed.valid) {
      return parsed.reason
    }
    await updateSession(whatsapp, 'onboarding', { ...temp, ...parsed.data })
    return null
  }

  if (step === 'select_bank') {
    const lang = getLang(temp)
    const choice = parseInt(message, 10)
    const candidates = temp.bankCandidates || []

    if (isNaN(choice) || choice < 1 || choice > candidates.length) {
      const numbered = candidates.map((c, i) => `${i + 1}. ${c.name}`).join('\n')
      return getMessage('select_bank_invalid', lang, { numbered })
    }

    const chosen = candidates[choice - 1]
    let bankResult
    try {
      bankResult = await verifyAndLinkResolvedBank(temp.userId, chosen, temp.bank_account_number)
    } catch (err) {
      console.error('select_bank: verification failed', temp.userId, chosen, err)
      return getMessage('select_bank_error', lang, { err: err.message })
    }

    const updatedTemp = { ...temp, bank_name: bankResult.bankName, bank_verified: true }
    await updateSession(whatsapp, 'confirm_plan', updatedTemp)
    return buildPlanMessage(updatedTemp, lang)
  }

  if (step === 'confirm_plan') {
    const lang = getLang(temp)

    if (upper === 'CONFIRM') {
      const userId = await createOrUpdateAccount(whatsapp, {
        full_name: temp.full_name,
        email: temp.email,
        bank_name: temp.bank_name,
        bank_account_number: temp.bank_account_number,
        residential_address: temp.address_display,
        language: lang,
      })

      let anchorResult
      try {
        anchorResult = await provisionAnchorAccount(userId, temp.address)
      } catch (err) {
        console.error('CONFIRM: Anchor provisioning failed', whatsapp, err)
        return getMessage('anchor_provision_error', lang, { err: err.message })
      }

      // Rare case: verification was already approved on an earlier
      // attempt (e.g. trader retried CONFIRM after a network hiccup) —
      // the account is ready right now, so activate immediately.
      if (anchorResult.status === 'ready') {
        await startCycle(userId, temp.daily_amount)
        await clearSession(whatsapp)
        return getMessage('cycle_activated', lang, {
          name: temp.full_name,
          dailyAmount: parseFloat(temp.daily_amount).toLocaleString(),
          accountNumber: anchorResult.accountNumber,
          isNew: true,
        })
      }

      // Normal case: verification was just triggered and Anchor hasn't
      // responded yet. Stash daily_amount in session so the webhook
      // (app/api/anchor-webhook/route.js) can start the cycle itself
      // once approval comes back — no cycle exists yet at this point.
      await updateSession(whatsapp, 'awaiting_kyc_approval', { daily_amount: temp.daily_amount, language: lang })
      return getMessage('kyc_pending', lang, { fullName: temp.full_name })
    }
    if (upper === 'EDIT') {
      await updateSession(whatsapp, 'onboarding', { language: lang })
      const verifyLink = `${APP_URL}/verify?ref=${whatsapp}`
      return getMessage('edit_redo_details', lang, { verifyLink })
    }
    if (upper === 'CANCEL') {
      await clearSession(whatsapp)
      return getMessage('cancel_confirmation', lang)
    }
    return getMessage('confirm_plan_prompt', lang)
  }

  if (step === 'awaiting_kyc_approval') {
    const lang = getLang(temp)
    const user = await getUserByWhatsapp(whatsapp)
    if (!user) {
      return getMessage('awaiting_kyc_waiting', lang)
    }

    let result
    try {
      result = await checkAndFinalizeIfApproved(user.id)
    } catch (err) {
      console.error('awaiting_kyc_approval: check failed', whatsapp, err)
      return getMessage('awaiting_kyc_waiting', lang)
    }

    if (result.status === 'ready') {
      await startCycle(user.id, temp.daily_amount)
      await clearSession(whatsapp)
      return getMessage('cycle_activated', lang, {
        name: user.full_name,
        dailyAmount: parseFloat(temp.daily_amount).toLocaleString(),
        accountNumber: result.accountNumber,
        isNew: true,
      })
    }

    if (result.status === 'rejected') {
      await clearSession(whatsapp)
      return getMessage('awaiting_kyc_rejected', lang)
    }

    return getMessage('awaiting_kyc_waiting', lang)
  }

  if (step === 'cycle_complete') {
    if (upper === 'YES') {
      return await beginNewSavingsPlan(whatsapp, getLang(temp))
    }
    return getMessage('cycle_complete_prompt', getLang(temp))
  }

  if (upper === 'PAID') {
    const user = await getUserByWhatsapp(whatsapp)
    const lang = (user && user.language) || getLang(temp)
    if (!user) {
      return getMessage('no_account_found', lang)
    }

    const cycle = await getActiveCycle(user.id)
    if (!cycle) {
      // FIX (2026-08-24): same class of bug as the two above — this
      // told the trader to type 1 without ever putting the session
      // into 'main_menu', so "1" fell through to "I did not
      // understand". Reproduced live: PAID -> "type 1" -> "1" ->
      // fallback -> had to type MENU, then 1, to actually get through.
      await updateSession(whatsapp, 'main_menu', { language: lang })
      return getMessage('no_active_cycle_generic', lang)
    }
 
      const paidToday = await getTodaysContribution(cycle.id)
    if (paidToday) {
      // Calendar day, not payment count — matches the webhook's
      // confirmation message and the fixed 30-calendar-day cycle rule.
      const cycleDayNumber = Math.min(getCycleDayNumber(cycle.start_date), 30)
      const cycleDayNumber = Math.min(getCycleDayNumber(cycle.start_date), 30)
      const daysRemaining = Math.max(30 - cycleDayNumber, 0)
      // contribution_recorded is a WhatsApp Message Template — English
      // only until translated versions are submitted for approval in
      // Meta Business Manager (see lib/messages.js PHASE 1B note).
      return getMessage('contribution_recorded', 'en', {
        amount: parseFloat(cycle.daily_amount).toLocaleString(),
        dayNumber: cycleDayNumber,
        totalSaved: parseFloat(cycle.total_saved).toLocaleString(),
        daysRemaining,
        })
    }
 
    return getMessage('paid_not_received', lang)
        }
  if (upper.startsWith('SAVE')) {
    return getMessage('save_deprecated', getLang(temp))
  }
 
  if (upper === 'BALANCE') {
    const user = await getUserByWhatsapp(whatsapp)
    if (!user) {
      return getMessage('no_account_found', getLang(temp))
    }
    const lang = user.language || 'en'
 
    const cycle = await getActiveCycle(user.id)
   if (!cycle) {
      await updateSession(whatsapp, 'main_menu', { language: lang })
      return getMessage('no_active_cycle_balance', lang)
    }

  const s = getBalanceSummary(cycle)
    const daysToUnlock = 10 - s.cycleDayNumber
    const withdrawLine = s.canWithdraw
      ? `\n\nYou can withdraw anytime. Type WITHDRAW followed by an amount.`
      : `\n\nWithdrawals unlock on day 10 (${daysToUnlock} day${daysToUnlock === 1 ? '' : 's'} to go).` 
 
    return getMessage('balance', lang, {
      name: user.full_name,
      saved: s.totalSaved.toLocaleString(),
      daysContributed: s.daysContributed,
      progressBar: s.progressBar,
      progressPercent: s.progressPercent,
      expectedTotal: s.expectedTotal.toLocaleString(),
      commission: s.commission.toLocaleString(),
      expectedPayout: s.expectedPayout.toLocaleString(),
      withdrawLine,
    })
  }

if (upper.startsWith('WITHDRAW')) {
    const parts = message.split(' ')
    const amount = parseFloat((parts[1] || '').replace(/,/g, ''))
 
    const user = await getUserByWhatsapp(whatsapp)
    if (!user) {
      return getMessage('no_account_found', getLang(temp))
    }
    const lang = user.language || 'en'
 
    const cycle = await getActiveCycle(user.id)
    if (!cycle) {
      await updateSession(whatsapp, 'main_menu', { language: lang })
      return getMessage('no_active_cycle_generic', lang)
    }

  if (isNaN(amount)) {
      return getMessage('withdraw_usage', lang)
    }
 
  const quote = await quoteWithdrawalForCycle(cycle, amount)
    if (!quote.allowed) {
      // quote.reason comes from lib/withdrawal.js and stays
      // English-only for now — same known gap as lib/savings.js.
      return quote.reason
    }
 
    await updateSession(whatsapp, 'awaiting_withdrawal_confirmation', {
      cycleId: cycle.id,
      requestedAmount: quote.requestedAmount,
      language: lang,
    })
    // quote.confirmationMessage comes from lib/withdrawal.js and stays
    // English-only for now, same known gap.
  return quote.confirmationMessage
  }
 
if (upper === 'YES' && step === 'awaiting_withdrawal_confirmation') {
    const lang = getLang(temp)
    const result = await processWithdrawal(temp.cycleId, temp.requestedAmount, anchorPayout)
 
    if (!result.success) {
      await clearSession(whatsapp)
      return getMessage('withdrawal_failed', lang, { reason: result.reason })
    }
 
    if (result.cycleEnded) {
      await updateSession(whatsapp, 'cycle_complete', { language: lang })
      return getMessage('withdrawal_cycle_ended', lang, { netAmount: result.netAmount.toLocaleString() })
    }

  await clearSession(whatsapp)
    return getMessage('withdrawal_success', lang, { netAmount: result.netAmount.toLocaleString() })
  }
 
  if (upper === 'NO' && step === 'awaiting_withdrawal_confirmation') {
    await clearSession(whatsapp)
    return getMessage('withdrawal_cancelled', getLang(temp))
  }
 
  if (upper === 'FREEZE') {
    const user = await getUserByWhatsapp(whatsapp)
    if (!user) {
      return getMessage('freeze_no_account', getLang(temp))
    }


 await freezeAccount(user.id)
    return getMessage('freeze_confirmation', user.language || 'en', { name: user.full_name })
  }
 
  if (upper === 'HELP') {
    const user = await getUserByWhatsapp(whatsapp)
    return getMessage('help', (user && user.language) || getLang(temp))
  }
 
  return getMessage('fallback_not_understood', getLang(temp))
}
export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const mode = searchParams.get('hub.mode')
  const token = searchParams.get('hub.verify_token')
  const challenge = searchParams.get('hub.challenge')

if (mode === 'subscribe' && token === META_VERIFY_TOKEN) {
    return new NextResponse(challenge, { status: 200 })
  }
 
  return new NextResponse('Verification failed', { status: 403 })
}
 
  export async function POST(request) {
  try {
    const payload = await request.json()
    const entry = payload.entry?.[0]
    const change = entry?.changes?.[0]
    const message = change?.value?.messages?.[0]
 
    if (!message || message.type !== 'text') {
      return new NextResponse('OK', { status: 200 })
    }

    const from = message.from
    const body = message.text.body
 
    const responseText = await handleMessage(from, body)
    if (responseText) {
      await sendMessage(from, responseText)
    }
 
    return new NextResponse('OK', { status: 200 })
  } catch (error) {
    console.error('Webhook error:', error)
    return new NextResponse('Error', { status: 500 })
  }
  }
