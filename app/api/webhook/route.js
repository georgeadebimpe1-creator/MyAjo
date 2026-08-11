import { NextResponse } from 'next/server'
import { supabase } from '../../lib/supabase'
import { sendMessage } from '../../lib/whatsapp'
import { getMessage } from '../../lib/messages'
import { quoteWithdrawalForCycle, processWithdrawal, stubPayout } from '../../lib/withdrawal'
import { getSession, updateSession, clearSession } from '../../lib/session'
import { getUserByWhatsapp, createOrUpdateAccount, freezeAccount } from '../../lib/accounts'
import { getActiveCycle, startCycle, getBalanceSummary, getTodaysContribution, projectPlan } from '../../lib/savings'

const META_VERIFY_TOKEN = process.env.META_VERIFY_TOKEN
const APP_URL = process.env.APP_URL || 'https://my-ajo-ten.vercel.app'

// NOTE: everything below is WhatsApp-specific — reading the trader's raw
// text, matching commands, and writing back plain-text replies. All the
// actual account/savings work now lives in lib/session.js, lib/accounts.js,
// and lib/savings.js, and can be called the same way from any future
// channel without touching this file.

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
      const existingUser = await getUserByWhatsapp(whatsapp)

      if (existingUser) {
        const activeCycle = await getActiveCycle(existingUser.id)
        if (activeCycle) {
          await clearSession(whatsapp)
          return `You already have an active savings cycle running.\n\nType BALANCE to check your savings, PAID to confirm today's transfer, or WITHDRAW followed by an amount to withdraw.`
        }
      }

      await updateSession(whatsapp, 'get_name', {})
      return `Great! Let us create your savings plan.\n\nWhat is your full name?`
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
      return `How MyAjo Works\n\nMyAjo is a digital daily savings platform built on the trusted ajo tradition.\n\n1. You choose how much to save every day\n2. You save daily for 30 days\n3. At the end of 30 days you collect your full savings minus MyAjo commission of 3%\n\nExample:\nSave N1,000 every day\nTotal after 30 days: N30,000\nMyAjo commission: N900 (3%)\nYou receive: N29,100\n\nNeed your money before 30 days? You can withdraw anytime after day 10 — a small fee from our banking partner applies (N50 for withdrawals up to N10,000, N100 above that). MyAjo never charges you extra for this.\n\nYour money is safe and held by our licensed banking partner.\n\nType 1 to start saving today.`
    }

    if (message === '4') {
      await clearSession(whatsapp)
      return `Support\n\nTo speak with our support team please send an email to hello@myajo.com.ng or call 08029708278 during business hours Monday to Friday 8am to 5pm.\n\nType MENU to return to the main menu.`
    }

    return `Please reply with a number between 1 and 4 to choose an option.\n\n1. Start Daily Savings\n2. Check My Balance\n3. Learn How It Works\n4. Speak with Support`
  }

  if (step === 'get_name') {
    const verifyLink = `${APP_URL}/verify?ref=${whatsapp}`
    await updateSession(whatsapp, 'awaiting_verification', { ...temp, full_name: message })
    return `Nice to meet you ${message}.\n\nTo keep your money safe, please verify your identity here:\n${verifyLink}\n\nIt takes about a minute. Once you're done, come back here and type DONE.`
  }

  if (step === 'awaiting_verification') {
    if (upper === 'DONE') {
      const user = await getUserByWhatsapp(whatsapp)

      if (user && user.kyc_status === 'verified') {
        await updateSession(whatsapp, 'get_email', temp)
        return `You're verified! Just one more thing — what's your email address?`
      }

      if (user && user.kyc_status === 'failed') {
        const verifyLink = `${APP_URL}/verify?ref=${whatsapp}`
        return `Hmm, we couldn't verify your details. This usually happens if the photo was blurry or didn't match your BVN.\n\nPlease try again here: ${verifyLink}\n\nThen type DONE.`
      }

      return `Still checking your details, this usually takes just a moment. Please type DONE again in a minute.`
    }
    return `Please complete your verification using the link above, then type DONE.`
  }

  if (step === 'get_email') {
    if (!message.includes('@') || !message.includes('.')) {
      return `That doesn't look like a valid email address. Please try again.`
    }
    await updateSession(whatsapp, 'get_bank', { ...temp, email: message })
    return `Got it. We will use your WhatsApp number as your savings account number so no extra registration is needed.\n\nWhich bank would you like your payout sent to?`
  }

  if (step === 'get_bank') {
    await updateSession(whatsapp, 'get_account_number', { ...temp, bank_name: message })
    return `Please enter your ${message} account number.`
  }

  if (step === 'get_account_number') {
    if (message.length < 10) {
      return `That account number looks too short. Please enter your full 10 digit account number.`
    }
    await updateSession(whatsapp, 'confirm_account', { ...temp, bank_account_number: message })
    return `We found:\n\n${temp.full_name}\n${temp.bank_name}\n${message}\n\nIs this correct?\n\n1. Yes, that is correct\n2. No, let me re-enter`
  }

  if (step === 'confirm_account') {
    if (message === '1') {
      await updateSession(whatsapp, 'get_amount', temp)
      return `How much would you like to save every day?\n\nExamples:\n1000\n2000\n3000\n5000\n10000\n\nReply with the amount in Naira.`
    }
    if (message === '2') {
      await updateSession(whatsapp, 'get_bank', { full_name: temp.full_name })
      return `No problem. Which bank would you like your payout sent to?`
    }
    return `Please reply with 1 to confirm or 2 to re-enter your details.`
  }

  if (step === 'get_amount') {
    const amount = parseFloat(message)
    if (isNaN(amount) || amount < 1000) {
      return `The minimum daily savings amount is N1000. Please enter a valid amount.`
    }
    if (amount > 450000) {
      return `For daily amounts above N450,000, please contact our support team directly at hello@myajo.com.ng so we can set this up for you.`
    }

    const plan = projectPlan(amount)
    await updateSession(whatsapp, 'confirm_plan', { ...temp, daily_amount: amount })
    return `Your Savings Plan\n\nDaily amount: N${amount.toLocaleString()}\nDuration: 30 days\nTotal savings: N${plan.totalSavings.toLocaleString()}\nMyAjo commission: N${plan.commission.toLocaleString()} (3%)\nYou will receive: N${plan.payout.toLocaleString()}\n\nYour payout goes to:\n${temp.bank_name} - ${temp.bank_account_number}\n\nType CONFIRM to activate your savings plan or CANCEL to start over.`
  }

  if (step === 'confirm_plan') {
    if (upper === 'CONFIRM') {
      const userId = await createOrUpdateAccount(whatsapp, {
        full_name: temp.full_name,
        email: temp.email,
        bank_name: temp.bank_name,
        bank_account_number: temp.bank_account_number,
      })

      await startCycle(userId, temp.daily_amount)
      await clearSession(whatsapp)
      return `Your savings plan is now active!\n\n${temp.full_name} your MyAjo journey has begun.\n\nRemember to save N${parseFloat(temp.daily_amount).toLocaleString()} every day for 30 days.\n\nWhen your transfer goes through, we will confirm it automatically. You can also type PAID anytime to check.\n\nGood luck and stay consistent!`
    }
    if (upper === 'CANCEL') {
      await clearSession(whatsapp)
      return `No problem. Type MENU whenever you are ready to start your savings plan.`
    }
    return `Please type CONFIRM to activate your plan or CANCEL to start over.`
  }

  // PAID — checks whether today's contribution has already been
  // confirmed by the Anchor deposit webhook. This does NOT record a
  // contribution itself; only a real, bank-confirmed deposit does that.
  // Letting a typed word insert a contribution directly would let
  // anyone claim credit for a transfer they never made.
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

  // Redirect anyone still typing the old SAVE command.
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
    const result = await processWithdrawal(temp.cycleId, temp.requestedAmount, stubPayout)
    await clearSession(whatsapp)

    if (!result.success) {
      return `Withdrawal could not be completed: ${result.reason}`
    }

    const cycleMsg = result.cycleEnded
      ? `\n\nYour savings cycle has ended. Type 1 to start a new one whenever you are ready.`
      : ''
    return `N${result.netAmount.toLocaleString()} is on its way to your account.${cycleMsg}`
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
    return `Your MyAjo account has been frozen immediately ${user.full_name}. No transactions can be made until you contact our support team to unfreeze it.\n\nContact us at hello@myajo.ng or call 08029708278.`
  }

  if (upper === 'HELP') {
    return `Temi Commands\n\nMENU - Return to main menu\nBALANCE - Check your savings\nPAID - Confirm today's transfer has gone through\nWITHDRAW 5000 - Withdraw an amount from your savings (available from day 10)\nFREEZE - Freeze your account\nHELP - Show this menu\n\nWithdrawing before your 30 day cycle ends attracts a small charge from our banking partner (N50 up to N10,000, N100 above that). MyAjo never adds anything on top. Complete the full cycle and there is no charge at all.\n\nFor support contact hello@myajo.ng`
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
    await sendMessage(from, responseText)

    return new NextResponse('OK', { status: 200 })
  } catch (error) {
    console.error('Webhook error:', error)
    return new NextResponse('Error', { status: 500 })
  }
}
