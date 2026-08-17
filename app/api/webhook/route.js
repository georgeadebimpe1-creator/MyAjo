import { NextResponse } from 'next/server'
import { supabase } from '../../lib/supabase'
import { sendMessage } from '../../lib/whatsapp'
import { getMessage } from '../../lib/messages'
import { quoteWithdrawalForCycle, processWithdrawal } from '../../lib/withdrawal'
import { anchorPayout } from '../../lib/payout'
import { getSession, updateSession, clearSession } from '../../lib/session'
import { getUserByWhatsapp, createOrUpdateAccount, freezeAccount, provisionAnchorAccount, verifyAndLinkBankAccount, verifyAndLinkResolvedBank } from '../../lib/accounts'
import { getActiveCycle, startCycle, getBalanceSummary, getTodaysContribution, projectPlan, validateDailyAmount, calculateCommission } from '../../lib/savings'

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
function parseOnboardingDetails(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0)

  if (lines.length !== 6) {
    return {
      valid: false,
      reason: `I need all 6 details, each on its own line:\n\nFull Name\nEmail Address\nResidential Address (Street, City, State)\nBank Name\nAccount Number\nDaily savings amount (1000-10000)\n\nExample:\nAda Okafor\nada@email.com\n12 Market Road, Ikeja, Lagos\nGTBank\n0123456789\n5000`,
    }
  }

  const [fullName, email, addressRaw, bankName, accountNumberRaw, amountRaw] = lines
  const accountNumber = accountNumberRaw.replace(/\s/g, '')

  if (!email.includes('@') || !email.includes('.')) {
    return { valid: false, reason: `That email address doesn't look right. Please resend all 6 details with a valid email.` }
  }

  const addressParts = addressRaw.split(',').map(p => p.trim()).filter(p => p.length > 0)
  if (addressParts.length < 2) {
    return {
      valid: false,
      reason: `Please include your street address and state, separated by commas — for example: 12 Market Road, Ikeja, Lagos.\n\nPlease resend all 6 details.`,
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
    return { valid: false, reason: `That account number doesn't look right — it should be 10 digits. Please resend all 6 details.` }
  }

  const dailyAmount = parseFloat(amountRaw.replace(/,/g, ''))
  const { valid, reason } = validateDailyAmount(dailyAmount)
  if (!valid) {
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

async function beginNewSavingsPlan(whatsapp) {
  const existingUser = await getUserByWhatsapp(whatsapp)

  if (existingUser) {
    const activeCycle = await getActiveCycle(existingUser.id)
    if (activeCycle) {
      await clearSession(whatsapp)
      return `You already have an active savings cycle running.\n\nType BALANCE to check your savings, PAID to confirm today's transfer, or WITHDRAW followed by an amount to withdraw.`
    }
  }

  await updateSession(whatsapp, 'onboarding', {})
  const verifyLink = `${APP_URL}/verify?ref=${whatsapp}`
  return `Great! Let's set up your savings plan. Two things to do — in any order:\n\n1) Verify your identity here (takes about a minute):\n${verifyLink}\n\n2) Reply here with your details, one per line:\n\nFull Name\nEmail Address\nResidential Address (Street, City, State)\nBank Name\nAccount Number\nDaily savings amount (1000-10000)\n\nExample:\nAda Okafor\nada@email.com\n12 Market Road, Ikeja, Lagos\nGTBank\n0123456789\n5000\n\nOnce you've done both, type DONE.`
}

function buildPlanMessage(temp) {
  const plan = projectPlan(temp.daily_amount)
  return `You're verified! Here's your plan:\n\nDaily amount: N${temp.daily_amount.toLocaleString()}\nDuration: 30 days\nTotal savings: N${plan.totalSavings.toLocaleString()}\nMyAjo commission: N${plan.commission.toLocaleString()}\nYou will receive: N${plan.payout.toLocaleString()}\n\nPayout goes to:\n${temp.bank_name} - ${temp.bank_account_number}\nName: ${temp.full_name}\nEmail: ${temp.email}\nAddress: ${temp.address_display}\n\nIf this all looks correct, type CONFIRM to activate.\nIf anything needs fixing, type EDIT to re-enter your details.`
}

async function handleMessage(from, body) {
  const whatsapp = from.startsWith('234') ? '0' + from.slice(3) : from
  const message = body.trim()
  const upper = message.toUpperCase()
  const session = await getSession(whatsapp)
  const step = session ? session.step : 'welcome'
  const temp = session ? session.temp_data : {}

  if (upper === 'MENU' || upper === 'START' || upper === 'HI' || upper === 'HELLO' || !session) {
    await updateSession(whatsapp, 'main_menu', {})
    return `Welcome to MyAjo. I am Temi, your personal savings assistant.\n\nI am here to help you build a consistent daily savings habit.\n\nPlease choose an option:\n\n1. Start Daily Savings\n2. Check My Balance\n3. Learn How It Works\n4. Speak with Support\n\nReply with a number.`
  }

  if (step === 'main_menu') {
    if (message === '1') {
      return await beginNewSavingsPlan(whatsapp)
    }

    if (message === '2') {
      await updateSession(whatsapp, 'check_balance', {})
      const user = await getUserByWhatsapp(whatsapp)

      if (!user) {
        await clearSession(whatsapp)
        return `I could not find your account. Please type 1 to start your savings plan first.`
      }

      const cycle = await getActiveCycle(user.id)
      if (!cycle) {
        await clearSession(whatsapp)
        return `You do not have an active savings cycle yet.\n\nType 1 to start your savings plan.`
      }

      const s = getBalanceSummary(cycle)
      await clearSession(whatsapp)
      return `Your Savings\n\nHello ${user.full_name}\n\nSaved: N${s.totalSaved.toLocaleString()}\nToday's status: ${s.daysContributed > 0 ? 'Active' : 'Not started'}\nDays completed: ${s.daysContributed} of 30\nDays remaining: ${s.daysRemaining}\n\nExpected total: N${s.expectedTotal.toLocaleString()}\nMyAjo commission: N${s.commission.toLocaleString()}\nYour payout: N${s.expectedPayout.toLocaleString()}\n\nType MENU to return to the main menu.`
    }

    if (message === '3') {
      await clearSession(whatsapp)
      const exampleCommission = calculateCommission(1000)
      const examplePayout = 30000 - exampleCommission
      return `How MyAjo Works\n\nMyAjo is a digital daily savings platform built on the trusted ajo tradition.\n\n1. You choose how much to save every day\n2. You save daily for 30 days\n3. At the end of 30 days you collect your full savings minus MyAjo's commission\n\nExample:\nSave N1,000 every day\nTotal after 30 days: N30,000\nMyAjo commission: N${exampleCommission.toLocaleString()}\nYou receive: N${examplePayout.toLocaleString()}\n\nNeed your money before 30 days? You can withdraw anytime after day 10 — a small fee from our banking partner applies (N50 for withdrawals up to N10,000, N100 above that). MyAjo never charges you extra for this.\n\nYour money is safe and held by our licensed banking partner.\n\nType 1 to start saving today.`
    }

    if (message === '4') {
      await clearSession(whatsapp)
      return `Support\n\nTo speak with our support team please send an email to hello@myajo.com.ng or call 08029708278 during business hours Monday to Friday 8am to 5pm.\n\nType MENU to return to the main menu.`
    }

    return `Please reply with a number between 1 and 4 to choose an option.\n\n1. Start Daily Savings\n2. Check My Balance\n3. Learn How It Works\n4. Speak with Support`
  }

  if (step === 'onboarding') {
    if (upper === 'DONE') {
      const user = await getUserByWhatsapp(whatsapp)

      if (!temp.full_name) {
        return `I haven't received your details yet. Please send your full name, email, residential address, bank name, account number, and daily amount — each on its own line — then type DONE again.`
      }

      if (!user || user.kyc_status !== 'verified') {
        if (user && user.kyc_status === 'failed') {
          const verifyLink = `${APP_URL}/verify?ref=${whatsapp}`
          return `Hmm, we couldn't verify your details. This usually happens if the photo was blurry or didn't match your BVN.\n\nPlease try again here: ${verifyLink}\n\nThen type DONE.`
        }
        return `Still checking your verification, this usually takes just a moment. Please type DONE again in a minute.`
      }

      if (!temp.bank_verified) {
        let bankResult
        try {
          bankResult = await verifyAndLinkBankAccount(user.id, temp.bank_name, temp.bank_account_number)
        } catch (err) {
          console.error('DONE: bank verification threw unexpectedly', whatsapp, err)
          return `We hit a snag verifying your bank details (${err.message}). Please type DONE again in a moment, or type EDIT to re-enter your details.`
        }

        if (bankResult.retype) {
          return `We couldn't find a bank matching "${temp.bank_name}". Please resend all 6 details with the correct bank name.`
        }

        if (bankResult.needsSelection) {
          const numbered = bankResult.candidates.map((c, i) => `${i + 1}. ${c.name}`).join('\n')
          await updateSession(whatsapp, 'select_bank', {
            ...temp,
            userId: user.id,
            bankCandidates: bankResult.candidates,
          })
          return `A few banks matched "${temp.bank_name}" — which one is it?\n\n${numbered}\n\nReply with the number.`
        }

        temp.bank_name = bankResult.bankName
        temp.bank_verified = true
      }

      await updateSession(whatsapp, 'confirm_plan', temp)
      return buildPlanMessage(temp)
    }

    const parsed = parseOnboardingDetails(message)
    if (!parsed.valid) {
      return parsed.reason
    }
    await updateSession(whatsapp, 'onboarding', { ...temp, ...parsed.data })
    return null
  }

  if (step === 'select_bank') {
    const choice = parseInt(message, 10)
    const candidates = temp.bankCandidates || []

    if (isNaN(choice) || choice < 1 || choice > candidates.length) {
      const numbered = candidates.map((c, i) => `${i + 1}. ${c.name}`).join('\n')
      return `Please reply with just the number of your bank:\n\n${numbered}`
    }

    const chosen = candidates[choice - 1]
    let bankResult
    try {
      bankResult = await verifyAndLinkResolvedBank(temp.userId, chosen, temp.bank_account_number)
    } catch (err) {
      console.error('select_bank: verification failed', temp.userId, chosen, err)
      return `We hit a snag verifying that account (${err.message}). Please reply with the number again, or type MENU to start over.`
    }

    const updatedTemp = { ...temp, bank_name: bankResult.bankName, bank_verified: true }
    await updateSession(whatsapp, 'confirm_plan', updatedTemp)
    return buildPlanMessage(updatedTemp)
  }

  if (step === 'confirm_plan') {
    if (upper === 'CONFIRM') {
      const userId = await createOrUpdateAccount(whatsapp, {
        full_name: temp.full_name,
        email: temp.email,
        bank_name: temp.bank_name,
        bank_account_number: temp.bank_account_number,
        residential_address: temp.address_display,
      })

      let anchorAccount
      try {
        anchorAccount = await provisionAnchorAccount(userId, temp.address)
      } catch (err) {
        console.error('CONFIRM: Anchor provisioning failed', whatsapp, err)
        return `We hit a snag setting up your deposit account (${err.message}). Please type CONFIRM again in a moment — if it keeps happening, type HELP to reach support.`
      }

      await startCycle(userId, temp.daily_amount)
      await clearSession(whatsapp)
      return `Your savings plan is now active!\n\n${temp.full_name} your MyAjo journey has begun.\n\nSend your daily savings of N${parseFloat(temp.daily_amount).toLocaleString()} to this account:\n\nAccount Number: ${anchorAccount.accountNumber}\n(This is your dedicated MyAjo savings account, held with our licensed banking partner.)\n\nWhen your transfer goes through, we will confirm it automatically. You can also type PAID anytime to check.\n\nGood luck and stay consistent!`
    }
    if (upper === 'EDIT') {
      await updateSession(whatsapp, 'onboarding', {})
      const verifyLink = `${APP_URL}/verify?ref=${whatsapp}`
      return `No problem, let's redo your details.\n\nPlease reply with your details in this format (one per line):\n\nFull Name\nEmail Address\nResidential Address (Street, City, State)\nBank Name\nAccount Number\nDaily savings amount (1000-10000)\n\nExample:\nAda Okafor\nada@email.com\n12 Market Road, Ikeja, Lagos\nGTBank\n0123456789\n5000\n\nIf you still need to verify your identity, do that here too:\n${verifyLink}\n\nOnce done, type DONE.`
    }
    if (upper === 'CANCEL') {
      await clearSession(whatsapp)
      return `No problem. Type MENU whenever you are ready to start your savings plan.`
    }
    return `Please type CONFIRM to activate your plan, EDIT to fix your details, or CANCEL to start over.`
  }

  if (step === 'cycle_complete') {
    if (upper === 'YES') {
      return await beginNewSavingsPlan(whatsapp)
    }
    return `Type YES to start a new 30-day savings cycle, or MENU to see all options.`
  }

  if (upper === 'PAID') {
    const user = await getUserByWhatsapp(whatsapp)
    if (!user) {
      return `I could not find your account. Type MENU to get started.`
    }

    const cycle = await getActiveCycle(user.id)
    if (!cycle) {
      return `You do not have an active savings cycle. Type 1 to start one.`
    }

    const paidToday = await getTodaysContribution(cycle.id)
    if (paidToday) {
      const daysRemaining = 30 - cycle.days_contributed
      return getMessage('contribution_recorded', 'en', {
        amount: parseFloat(cycle.daily_amount).toLocaleString(),
        dayNumber: cycle.days_contributed,
        totalSaved: parseFloat(cycle.total_saved).toLocaleString(),
        daysRemaining,
      })
    }

    return `We haven't received your transfer yet. Bank transfers can take a few minutes to reflect — Temi will confirm automatically as soon as it comes in. If it's been more than 30 minutes, type HELP to contact support.`
  }

  if (upper.startsWith('SAVE')) {
    return `We've simplified this — you no longer need to send a reference number. Just make your transfer, then reply PAID and Temi will confirm it for you.`
  }

  if (upper === 'BALANCE') {
    const user = await getUserByWhatsapp(whatsapp)
    if (!user) {
      return `I could not find your account. Type MENU to get started.`
    }

    const cycle = await getActiveCycle(user.id)
    if (!cycle) {
      return `You do not have an active savings cycle.\n\nType 1 to start saving today.`
    }

    const s = getBalanceSummary(cycle)
    const withdrawLine = s.canWithdraw
      ? `\n\nYou can withdraw anytime. Type WITHDRAW followed by an amount.`
      : `\n\nWithdrawals unlock on day 10 (${10 - s.daysContributed} day${10 - s.daysContributed === 1 ? '' : 's'} to go).`

    return `Your Savings\n\nHello ${user.full_name}\n\nSaved: N${s.totalSaved.toLocaleString()}\nDays completed: ${s.daysContributed} of 30\n\nProgress: ${s.progressBar} ${s.progressPercent}%\n\nExpected total: N${s.expectedTotal.toLocaleString()}\nMyAjo commission: N${s.commission.toLocaleString()}\nYour payout: N${s.expectedPayout.toLocaleString()}${withdrawLine}\n\nKeep saving every day!`
  }

  if (upper.startsWith('WITHDRAW')) {
    const parts = message.split(' ')
    const amount = parseFloat((parts[1] || '').replace(/,/g, ''))

    const user = await getUserByWhatsapp(whatsapp)
    if (!user) {
      return `I could not find your account. Type MENU to get started.`
    }

    const cycle = await getActiveCycle(user.id)
    if (!cycle) {
      return `You do not have an active savings cycle. Type 1 to start one.`
    }

    if (isNaN(amount)) {
      return `To withdraw, send WITHDRAW followed by the amount.\n\nExample: WITHDRAW 5000`
    }

    const quote = await quoteWithdrawalForCycle(cycle, amount)
    if (!quote.allowed) {
      return quote.reason
    }

    await updateSession(whatsapp, 'awaiting_withdrawal_confirmation', {
      cycleId: cycle.id,
      requestedAmount: quote.requestedAmount,
    })
    return quote.confirmationMessage
  }

  if (upper === 'YES' && step === 'awaiting_withdrawal_confirmation') {
    const result = await processWithdrawal(temp.cycleId, temp.requestedAmount, anchorPayout)

    if (!result.success) {
      await clearSession(whatsapp)
      return `Withdrawal could not be completed: ${result.reason}`
    }

    if (result.cycleEnded) {
      await updateSession(whatsapp, 'cycle_complete', {})
      return `N${result.netAmount.toLocaleString()} is on its way to your account.\n\nYour savings cycle has ended.\n\nReady to begin your next cycle? Type YES.`
    }

    await clearSession(whatsapp)
    return `N${result.netAmount.toLocaleString()} is on its way to your account.`
  }

  if (upper === 'NO' && step === 'awaiting_withdrawal_confirmation') {
    await clearSession(whatsapp)
    return `Withdrawal cancelled. Your savings are untouched.`
  }

  if (upper === 'FREEZE') {
    const user = await getUserByWhatsapp(whatsapp)
    if (!user) {
      return `I could not find your account. Please contact support immediately.`
    }

    await freezeAccount(user.id)
    return `Your MyAjo account has been frozen immediately ${user.full_name}. No transactions can be made until you contact our support team to unfreeze it.\n\nContact us at hello@myajo.com.ng or call 08029708278.`
  }

  if (upper === 'HELP') {
    return `Temi Commands\n\nMENU - Return to main menu\nBALANCE - Check your savings\nPAID - Confirm today's transfer has gone through\nWITHDRAW 5000 - Withdraw an amount from your savings (available from day 10)\nFREEZE - Freeze your account\nHELP - Show this menu\n\nWithdrawing before your 30 day cycle ends attracts a small charge from our banking partner (N50 up to N10,000, N100 above that). MyAjo never adds anything on top. Complete the full cycle and there is no charge at all.\n\nFor support contact hello@myajo.com.ng`
  }

  return `I did not understand that. Type MENU to see your options or HELP to see all commands.`
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
