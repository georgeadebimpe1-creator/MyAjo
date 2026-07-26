import { NextResponse } from 'next/server'
import { supabase } from '../../lib/supabase'
import { quoteWithdrawalForCycle, processWithdrawal, stubPayout, getWithdrawableBalance } from '../../lib/withdrawal'

// --- META WHATSAPP CLOUD API SETUP ---
// These read the actual values from Vercel's Environment Variables page.
// Never put your real token, phone number ID, or verify token directly here —
// only the variable NAMES belong in this file.
const META_TOKEN = process.env.META_WHATSAPP_TOKEN
const META_PHONE_NUMBER_ID = process.env.META_PHONE_NUMBER_ID
const META_VERIFY_TOKEN = process.env.META_VERIFY_TOKEN
const META_API_URL = `https://graph.facebook.com/v20.0/${META_PHONE_NUMBER_ID}/messages`
const APP_URL = process.env.APP_URL || 'https://my-ajo-ten.vercel.app'

// Sends a WhatsApp message via Meta's Cloud API (replaces the old Twilio sendMessage)
async function sendMessage(to, message) {
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

  // If Meta rejects the message (bad token, unverified recipient, etc.)
  // this logs the exact reason instead of failing silently.
  if (!response.ok) {
    const errorBody = await response.text()
    console.error('Meta send failed:', response.status, errorBody)
  }
}

// Commission rate: 3% of total 30-day savings.
// Kept as one constant so the SAME number is used everywhere it's calculated,
// instead of being written out separately in different places (which is what
// caused the mismatch between the example text and the actual charge before).
const COMMISSION_RATE = 0.03

async function getSession(whatsapp) {
  const { data } = await supabase
    .from('sessions')
    .select('*')
    .eq('whatsapp_number', whatsapp)
    .single()
  return data
}

async function updateSession(whatsapp, step, tempData = {}) {
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

async function clearSession(whatsapp) {
  await supabase
    .from('sessions')
    .update({ step: 'welcome', temp_data: {} })
    .eq('whatsapp_number', whatsapp)
}

async function handleMessage(from, body) {
  // Meta sends the number as plain digits, e.g. "2348012345678" (no "whatsapp:" prefix)
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
      const { data: existingUser } = await supabase
        .from('users')
        .select('id')
        .eq('whatsapp_number', whatsapp)
        .single()

      if (existingUser) {
        const { data: activeCycle } = await supabase
          .from('cycles')
          .select('id')
          .eq('user_id', existingUser.id)
          .eq('status', 'active')
          .single()

        if (activeCycle) {
          await clearSession(whatsapp)
          return `You already have an active savings cycle running.\n\nType BALANCE to check your savings, SAVE followed by your reference to record today's contribution, or WITHDRAW followed by an amount to withdraw.`
        }
      }

      await updateSession(whatsapp, 'get_name', {})
      return `Great! Let us create your savings plan.\n\nWhat is your full name?`
    }

    if (message === '2') {
      await updateSession(whatsapp, 'check_balance', {})
      const { data: user } = await supabase
        .from('users')
        .select('id, full_name')
        .eq('whatsapp_number', whatsapp)
        .single()

      if (!user) {
        await clearSession(whatsapp)
        return `I could not find your account. Please type 1 to start your savings plan first.`
      }

      const { data: cycle } = await supabase
        .from('cycles')
        .select('daily_amount, days_contributed, total_saved, commission')
        .eq('user_id', user.id)
        .eq('status', 'active')
        .single()

      if (!cycle) {
        await clearSession(whatsapp)
        return `You do not have an active savings cycle yet.\n\nType 1 to start your savings plan.`
      }

      const daysRemaining = 30 - cycle.days_contributed
      const expectedTotal = parseFloat(cycle.total_saved) + (daysRemaining * parseFloat(cycle.daily_amount))
      const commission = parseFloat(cycle.commission)
      const expectedPayout = expectedTotal - commission

      await clearSession(whatsapp)
      return `Your Savings\n\nHello ${user.full_name}\n\nSaved: N${parseFloat(cycle.total_saved).toLocaleString()}\nToday's status: ${cycle.days_contributed > 0 ? 'Active' : 'Not started'}\nDays completed: ${cycle.days_contributed} of 30\nDays remaining: ${daysRemaining}\n\nExpected total: N${expectedTotal.toLocaleString()}\nMyAjo commission: N${commission.toLocaleString()}\nYour payout: N${expectedPayout.toLocaleString()}\n\nType MENU to return to the main menu.`
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
      const { data: user } = await supabase
        .from('users')
        .select('kyc_status')
        .eq('whatsapp_number', whatsapp)
        .single()

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
      return `How much would you like to save every day?\n\nExamples:\n1000\n2000\n3000\n5000\n\nReply with the amount in Naira.`
    }
    if (message === '2') {
      await updateSession(whatsapp, 'get_bank', { full_name: temp.full_name })
      return `No problem. Which bank would you like your payout sent to?`
    }
    return `Please reply with 1 to confirm or 2 to re-enter your details.`
  }

  if (step === 'get_amount') {
    const amount = parseFloat(message)
    if (isNaN(amount) || amount < 200) {
      return `The minimum daily savings amount is N1000. Please enter a valid amount.`
    }
    if (amount > 50000) {
      return `The maximum daily savings amount is N50,000. Please enter a lower amount.`
    }

    const totalSavings = amount * 30
    const commission = Math.round(totalSavings * COMMISSION_RATE)
    const payout = totalSavings - commission

    await updateSession(whatsapp, 'confirm_plan', { ...temp, daily_amount: amount })
    return `Your Savings Plan\n\nDaily amount: N${amount.toLocaleString()}\nDuration: 30 days\nTotal savings: N${totalSavings.toLocaleString()}\nMyAjo commission: N${commission.toLocaleString()} (3%)\nYou will receive: N${payout.toLocaleString()}\n\nYour payout goes to:\n${temp.bank_name} - ${temp.bank_account_number}\n\nType CONFIRM to activate your savings plan or CANCEL to start over.`
  }

  if (step === 'confirm_plan') {
    if (upper === 'CONFIRM') {
      const { data: existingUser } = await supabase
        .from('users')
        .select('id')
        .eq('whatsapp_number', whatsapp)
        .single()

      let userId

      if (existingUser) {
        userId = existingUser.id
        await supabase
          .from('users')
          .update({
            full_name: temp.full_name,
            email: temp.email,
            bank_name: temp.bank_name,
            bank_account_number: temp.bank_account_number,
          })
          .eq('id', userId)
      } else {
        const { data: newUser } = await supabase
          .from('users')
          .insert([{
            full_name: temp.full_name,
            phone_number: whatsapp,
            whatsapp_number: whatsapp,
            email: temp.email,
            bank_name: temp.bank_name,
            bank_account_number: temp.bank_account_number,
            bank_account_name: temp.full_name,
            status: 'active',
          }])
          .select()
          .single()
        userId = newUser.id
      }

      const totalSavings = temp.daily_amount * 30
      const commission = Math.round(totalSavings * COMMISSION_RATE)

      await supabase
        .from('cycles')
        .insert([{
          user_id: userId,
          daily_amount: temp.daily_amount,
          commission: commission,
          status: 'active',
          start_date: new Date().toISOString().split('T')[0],
        }])

      await clearSession(whatsapp)
      return `Your savings plan is now active!\n\n${temp.full_name} your MyAjo journey has begun.\n\nRemember to save N${parseFloat(temp.daily_amount).toLocaleString()} every day for 30 days.\n\nTo record your daily contribution send:\nSAVE followed by your bank transfer reference\n\nExample: SAVE TRF20240707001234\n\nGood luck and stay consistent!`
    }

    if (upper === 'CANCEL') {
      await clearSession(whatsapp)
      return `No problem. Type MENU whenever you are ready to start your savings plan.`
    }

    return `Please type CONFIRM to activate your plan or CANCEL to start over.`
  }

  if (upper.startsWith('SAVE')) {
    const parts = body.trim().split(' ')
    const reference = parts[1]

    if (!reference) {
      return `To record your contribution please include your bank transfer reference.\n\nExample: SAVE TRF20240707001234`
    }

    const { data: user } = await supabase
      .from('users')
      .select('id, full_name')
      .eq('whatsapp_number', whatsapp)
      .single()

    if (!user) {
      return `I could not find your account. Type MENU to get started.`
    }

    const { data: cycle } = await supabase
      .from('cycles')
      .select('id, daily_amount, days_contributed, total_saved, commission, bank_name, partial_withdrawals')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .single()

    if (!cycle) {
      return `You do not have an active savings cycle. Type 1 to start one.`
    }

    const today = new Date().toISOString().split('T')[0]
    const { data: alreadyPaid } = await supabase
      .from('contributions')
      .select('id')
      .eq('cycle_id', cycle.id)
      .eq('contribution_date', today)
      .single()

    if (alreadyPaid) {
      return `You have already recorded your contribution for today. Well done ${user.full_name}!\n\nType BALANCE to see your savings.`
    }

    const { error } = await supabase
      .from('contributions')
      .insert([{
        cycle_id: cycle.id,
        user_id: user.id,
        amount: cycle.daily_amount,
        contribution_date: today,
        payment_reference: reference,
        verified: false,
        contribution_type: 'daily',
      }])

    if (error) {
      return `Sorry I could not record your contribution right now. Please try again.`
    }

    const newDays = cycle.days_contributed + 1
    const newTotal = parseFloat(cycle.total_saved) + parseFloat(cycle.daily_amount)
    const commission = parseFloat(cycle.commission)
    const daysRemaining = 30 - newDays

    await supabase
      .from('cycles')
      .update({ days_contributed: newDays, total_saved: newTotal })
      .eq('id', cycle.id)

    if (newDays === 30) {
      // Full cycle completed, no early withdrawal taken along the way.
      // Route the payout through the same withdrawal engine used for
      // WITHDRAW, so there is one single source of truth for the money
      // math rather than duplicating it here.
      const updatedCycle = { ...cycle, days_contributed: newDays, total_saved: newTotal }
      const withdrawableBalance = await getWithdrawableBalance(updatedCycle)
      const result = await processWithdrawal(cycle.id, withdrawableBalance, stubPayout)

      if (!result.success) {
        return `Congratulations ${user.full_name}!\n\nYou have completed your 30 day savings plan, but your payout could not be processed automatically (${result.reason}).\n\nPlease contact support at hello@myajo.com.ng and we will resolve this right away.`
      }

      return `Congratulations ${user.full_name}!\n\nYou have completed your 30 day savings plan!\n\nTotal saved: N${newTotal.toLocaleString()}\nMyAjo commission: N${commission.toLocaleString()} (3%)\nYour payout: N${result.netAmount.toLocaleString()}\n\nYour payout is being sent to your ${cycle.bank_name || 'registered'} account. We will notify you once it has been sent.\n\nThank you for saving with MyAjo. Would you like to start another cycle? Type 1 to begin.`
    }

    const filled = Math.round((newDays / 30) * 10)
    const progressDisplay = '[' + '#'.repeat(filled) + '-'.repeat(10 - filled) + ']'

    return `Payment received ${user.full_name}!\n\nDay ${newDays} of 30 recorded.\n\nProgress: ${progressDisplay} ${Math.round((newDays / 30) * 100)}%\n\nYou have saved: N${newTotal.toLocaleString()}\nDays remaining: ${daysRemaining}\n\n${daysRemaining <= 5 ? 'You are almost there! Keep going!' : 'Stay consistent. Every day counts!'}${newDays === 10 ? '\n\nYou can now withdraw anytime you like if you need to. Type HELP to see how withdrawals work.' : ''}`
  }

  if (upper === 'BALANCE') {
    const { data: user } = await supabase
      .from('users')
      .select('id, full_name')
      .eq('whatsapp_number', whatsapp)
      .single()

    if (!user) {
      return `I could not find your account. Type MENU to get started.`
    }

    const { data: cycle } = await supabase
      .from('cycles')
      .select('daily_amount, days_contributed, total_saved, commission')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .single()

    if (!cycle) {
      return `You do not have an active savings cycle.\n\nType 1 to start saving today.`
    }

    const daysRemaining = 30 - cycle.days_contributed
    const expectedTotal = parseFloat(cycle.total_saved) + (daysRemaining * parseFloat(cycle.daily_amount))
    const commission = parseFloat(cycle.commission)
    const expectedPayout = expectedTotal - commission
    const filled = Math.round((cycle.days_contributed / 30) * 10)
    const progressDisplay = '[' + '#'.repeat(filled) + '-'.repeat(10 - filled) + ']'
    const withdrawLine = cycle.days_contributed >= 10
      ? `\n\nYou can withdraw anytime. Type WITHDRAW followed by an amount.`
      : `\n\nWithdrawals unlock on day 10 (${10 - cycle.days_contributed} day${10 - cycle.days_contributed === 1 ? '' : 's'} to go).`

    return `Your Savings\n\nHello ${user.full_name}\n\nSaved: N${parseFloat(cycle.total_saved).toLocaleString()}\nDays completed: ${cycle.days_contributed} of 30\n\nProgress: ${progressDisplay} ${Math.round((cycle.days_contributed / 30) * 100)}%\n\nExpected total: N${expectedTotal.toLocaleString()}\nMyAjo commission: N${commission.toLocaleString()}\nYour payout: N${expectedPayout.toLocaleString()}${withdrawLine}\n\nKeep saving every day!`
  }

  if (upper.startsWith('WITHDRAW')) {
    const parts = message.split(' ')
    const amount = parseFloat((parts[1] || '').replace(/,/g, ''))

    const { data: user } = await supabase
      .from('users')
      .select('id, full_name')
      .eq('whatsapp_number', whatsapp)
      .single()

    if (!user) {
      return `I could not find your account. Type MENU to get started.`
    }

    const { data: cycle } = await supabase
      .from('cycles')
      .select('*')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .single()

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
    const { data: user } = await supabase
      .from('users')
      .select('id, full_name')
      .eq('whatsapp_number', whatsapp)
      .single()

    if (!user) {
      return `I could not find your account. Please contact support immediately.`
    }

    await supabase
      .from('users')
      .update({ status: 'frozen' })
      .eq('id', user.id)

    return `Your MyAjo account has been frozen immediately ${user.full_name}. No transactions can be made until you contact our support team to unfreeze it.\n\nContact us at hello@myajo.ng or call 08029708278.`
  }

  if (upper === 'HELP') {
    return `Temi Commands\n\nMENU - Return to main menu\nBALANCE - Check your savings\nSAVE TRF123 - Record your daily contribution\nWITHDRAW 5000 - Withdraw an amount from your savings (available from day 10)\nFREEZE - Freeze your account\nHELP - Show this menu\n\nWithdrawing before your 30 day cycle ends attracts a small charge from our banking partner (N50 up to N10,000, N100 above that). MyAjo never adds anything on top. Complete the full cycle and there is no charge at all.\n\nFor support contact hello@myajo.ng`
  }

  return `I did not understand that. Type MENU to see your options or HELP to see all commands.`
}

// --- WEBHOOK VERIFICATION (Meta calls this once when you connect the webhook) ---
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

// --- INCOMING MESSAGES (Meta calls this every time a trader messages Temi) ---
export async function POST(request) {
  try {
    const payload = await request.json()

    const entry = payload.entry?.[0]
    const change = entry?.changes?.[0]
    const message = change?.value?.messages?.[0]

    // Meta also sends "status" updates (delivered/read) through this same endpoint.
    // We only want to react to actual incoming text messages, so we quietly
    // acknowledge anything else and stop.
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
