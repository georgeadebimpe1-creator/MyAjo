import { NextResponse } from 'next/server'
import { supabase } from '../../lib/supabase'
import twilio from 'twilio'

const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)

async function sendMessage(to, message) {
  await client.messages.create({
    from: process.env.TWILIO_WHATSAPP_NUMBER,
    to,
    body: message,
  })
}

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

function progressBar(days) {
  const filled = Math.round((days / 30) * 10)
  const empty = 10 - filled
  return 'filled '.repeat(filled).trim().split(' ').join('') + 'empty '.repeat(empty).trim().split(' ').join('')
}

async function handleMessage(from, body) {
  const whatsapp = from.replace('whatsapp:+234', '0').replace('whatsapp:+', '').replace('whatsapp:', '')
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
          return `You already have an active savings cycle running.\n\nType BALANCE to check your savings or SAVE followed by your reference to record today's contribution.`
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
      return `How MyAjo Works\n\nMyAjo is a digital daily savings platform built on the trusted ajo tradition.\n\n1. You choose how much to save every day\n2. You save daily for 30 days\n3. At the end of 30 days you collect your full savings minus one day as MyAjo commission\n\nExample:\nSave N1,000 every day\nTotal after 30 days: N30,000\nMyAjo commission: N1,000 (one day)\nYou receive: N29,000\n\nYour money is safe and held by our licensed banking partner.\n\nType 1 to start saving today.`
    }

    if (message === '4') {
      await clearSession(whatsapp)
      return `Support\n\nTo speak with our support team please send an email to hello@myajo.ng or call 08029708278 during business hours Monday to Friday 8am to 6pm.\n\nType MENU to return to the main menu.`
    }

    return `Please reply with a number between 1 and 4 to choose an option.\n\n1. Start Daily Savings\n2. Check My Balance\n3. Learn How It Works\n4. Speak with Support`
  }

  if (step === 'get_name') {
    await updateSession(whatsapp, 'get_bank', { ...temp, full_name: message })
    return `Nice to meet you ${message}.\n\nWe will use your WhatsApp number as your savings account number so no extra registration is needed.\n\nWhich bank would you like your payout sent to?`
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
      return `How much would you like to save every day?\n\nExamples:\n500\n1000\n2000\n5000\n\nReply with the amount in Naira.`
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
      return `The minimum daily savings amount is N200. Please enter a valid amount.`
    }
    if (amount > 50000) {
      return `The maximum daily savings amount is N50,000. Please enter a lower amount.`
    }

    const commission = amount
    const totalSavings = amount * 30
    const payout = totalSavings - commission

    await updateSession(whatsapp, 'confirm_plan', { ...temp, daily_amount: amount })
    return `Your Savings Plan\n\nDaily amount: N${amount.toLocaleString()}\nDuration: 30 days\nTotal savings: N${totalSavings.toLocaleString()}\nMyAjo commission: N${commission.toLocaleString()} (one day)\nYou will receive: N${payout.toLocaleString()}\n\nYour payout goes to:\n${temp.bank_name} - ${temp.bank_account_number}\n\nType CONFIRM to activate your savings plan or CANCEL to start over.`
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
            bank_name: temp.bank_name,
            bank_account_number: temp.bank_account_number,
            bank_account_name: temp.full_name,
            status: 'active',
          }])
          .select()
          .single()
        userId = newUser.id
      }

      await supabase
        .from('cycles')
        .insert([{
          user_id: userId,
          daily_amount: temp.daily_amount,
          commission: temp.daily_amount,
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
      .select('id, daily_amount, days_contributed, total_saved, commission')
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
      await supabase
        .from('cycles')
        .update({ status: 'completed' })
        .eq('id', cycle.id)

      return `Congratulations ${user.full_name}!\n\nYou have completed your 30 day savings plan!\n\nTotal saved: N${newTotal.toLocaleString()}\nMyAjo commission: N${commission.toLocaleString()} (one day)\nYour payout: N${(newTotal - commission).toLocaleString()}\n\nYour payout is being processed to your ${cycle.bank_name || 'registered'} account. We will notify you once it has been sent.\n\nThank you for saving with MyAjo. Would you like to start another cycle? Type 1 to begin.`
    }

    const bar = '|' + 'filled'.repeat(Math.round((newDays / 30) * 10)).replace(/filled/g, '') + 'empty'.repeat(10 - Math.round((newDays / 30) * 10)).replace(/empty/g, '') + '|'
    const filled = Math.round((newDays / 30) * 10)
    const progressDisplay = '[' + '#'.repeat(filled) + '-'.repeat(10 - filled) + ']'

    return `Payment received ${user.full_name}!\n\nDay ${newDays} of 30 recorded.\n\nProgress: ${progressDisplay} ${Math.round((newDays / 30) * 100)}%\n\nYou have saved: N${newTotal.toLocaleString()}\nDays remaining: ${daysRemaining}\n\n${daysRemaining <= 5 ? 'You are almost there! Keep going!' : 'Stay consistent. Every day counts!'}`
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

    return `Your Savings\n\nHello ${user.full_name}\n\nSaved: N${parseFloat(cycle.total_saved).toLocaleString()}\nDays completed: ${cycle.days_contributed} of 30\n\nProgress: ${progressDisplay} ${Math.round((cycle.days_contributed / 30) * 100)}%\n\nExpected total: N${expectedTotal.toLocaleString()}\nMyAjo commission: N${commission.toLocaleString()}\nYour payout: N${expectedPayout.toLocaleString()}\n\nKeep saving every day!`
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
    return `Temi Commands\n\nMENU - Return to main menu\nBALANCE - Check your savings\nSAVE TRF123 - Record your daily contribution\nFREEZE - Freeze your account\nHELP - Show this menu\n\nFor support contact hello@myajo.ng`
  }

  return `I did not understand that. Type MENU to see your options or HELP to see all commands.`
}

export async function POST(request) {
  try {
    const formData = await request.formData()
    const from = formData.get('From')
    const body = formData.get('Body')

    const response = await handleMessage(from, body)

    const twiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${response}</Message></Response>`

    return new NextResponse(twiml, {
      status: 200,
      headers: { 'Content-Type': 'text/xml' },
    })
  } catch (error) {
    console.error('Webhook error:', error)
    return new NextResponse('Error', { status: 500 })
  }
}