import { NextResponse } from 'next/server'
import { supabase } from '../../lib/supabase'
import twilio from 'twilio'

const accountSid = process.env.TWILIO_ACCOUNT_SID
const authToken = process.env.TWILIO_AUTH_TOKEN
const client = twilio(accountSid, authToken)

async function sendMessage(to, message) {
  await client.messages.create({
    from: process.env.TWILIO_WHATSAPP_NUMBER,
    to: to,
    body: message,
  })
}

async function handleMessage(from, body) {
  const whatsapp = from.replace('whatsapp:+234', '0').replace('whatsapp:', '')
  const message = body.trim().toUpperCase()

  if (message === 'HELLO' || message === 'HI' || message === 'START') {
    return `Hello! I am Temi, your MyAjo savings assistant.\n\nHere is what I can help you with:\n\nBALANCE - Check your savings balance\nSAVE - Record your daily contribution\nSTATUS - See your cycle progress\nFREEZE - Freeze your account\nHELP - See all commands\n\nType any command to get started.`
  }

  if (message === 'HELP') {
    return `Here are all Temi commands:\n\nBALANCE - Check your current savings\nSAVE REF123 - Record a contribution with your bank reference\nSTATUS - See your full cycle details\nFREEZE - Freeze your account immediately\nHELP - Show this menu\n\nFor example to record a contribution type:\nSAVE TRF20240703123456`
  }

  if (message === 'BALANCE') {
    const { data: user } = await supabase
      .from('users')
      .select('id, full_name')
      .eq('whatsapp_number', whatsapp)
      .single()

    if (!user) {
      return `Sorry, I could not find your number on MyAjo. Please register at our website first.`
    }

    const { data: cycle } = await supabase
      .from('cycles')
      .select('daily_amount, days_contributed, total_saved, commission, start_date')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .single()

    if (!cycle) {
      return `Hello ${user.full_name}. You do not have an active savings cycle yet. Visit our website to start your 30-day savings journey.`
    }

    const daysRemaining = 30 - cycle.days_contributed
    const expectedTotal = parseFloat(cycle.total_saved) + (daysRemaining * parseFloat(cycle.daily_amount))
    const expectedPayout = expectedTotal - parseFloat(cycle.commission)

    return `Hello ${user.full_name}\n\nYour MyAjo Balance\nDay ${cycle.days_contributed} of 30\nTotal saved: N${parseFloat(cycle.total_saved).toLocaleString()}\nDaily amount: N${parseFloat(cycle.daily_amount).toLocaleString()}\nDays remaining: ${daysRemaining}\nExpected payout: N${expectedPayout.toLocaleString()}\n\nKeep saving every day. You are doing well!`
  }

  if (message === 'STATUS') {
    const { data: user } = await supabase
      .from('users')
      .select('id, full_name')
      .eq('whatsapp_number', whatsapp)
      .single()

    if (!user) {
      return `Sorry, I could not find your number on MyAjo. Please register at our website first.`
    }

    const { data: cycle } = await supabase
      .from('cycles')
      .select('daily_amount, days_contributed, total_saved, commission, start_date')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .single()

    if (!cycle) {
      return `Hello ${user.full_name}. You do not have an active savings cycle. Visit our website to start saving.`
    }

    const percent = Math.round((cycle.days_contributed / 30) * 100)
    const daysRemaining = 30 - cycle.days_contributed

    return `Hello ${user.full_name}\n\nYour Savings Status\nStarted: ${cycle.start_date}\nProgress: ${percent}% complete\nDays done: ${cycle.days_contributed} of 30\nDays remaining: ${daysRemaining}\nSaved so far: N${parseFloat(cycle.total_saved).toLocaleString()}\nDaily amount: N${parseFloat(cycle.daily_amount).toLocaleString()}\nMyAjo commission: N${parseFloat(cycle.commission).toLocaleString()}\n\n${daysRemaining === 0 ? 'Your payout is ready! We will process it shortly.' : `${daysRemaining} more days to go. Stay consistent!`}`
  }

  if (message.startsWith('SAVE')) {
    const parts = body.trim().split(' ')
    const reference = parts[1]

    if (!reference) {
      return `To record your contribution please include your bank transfer reference.\n\nExample: SAVE TRF20240703123456`
    }

    const { data: user } = await supabase
      .from('users')
      .select('id, full_name')
      .eq('whatsapp_number', whatsapp)
      .single()

    if (!user) {
      return `Sorry, I could not find your number on MyAjo. Please register at our website first.`
    }

    const { data: cycle } = await supabase
      .from('cycles')
      .select('id, daily_amount, days_contributed, total_saved')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .single()

    if (!cycle) {
      return `Hello ${user.full_name}. You do not have an active savings cycle. Please visit our website to start one.`
    }

    const today = new Date().toISOString().split('T')[0]

    const { data: alreadyPaid } = await supabase
      .from('contributions')
      .select('id')
      .eq('cycle_id', cycle.id)
      .eq('contribution_date', today)
      .single()

    if (alreadyPaid) {
      return `Hello ${user.full_name}. You have already recorded your contribution for today. Well done for saving!\n\nType BALANCE to see your current savings.`
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
      return `Sorry, I could not record your contribution right now. Please try again or contact support.`
    }

    const newDays = cycle.days_contributed + 1
    const newTotal = parseFloat(cycle.total_saved) + parseFloat(cycle.daily_amount)

    await supabase
      .from('cycles')
      .update({ days_contributed: newDays, total_saved: newTotal })
      .eq('id', cycle.id)

    const daysRemaining = 30 - newDays

    return `Day ${newDays} recorded ${user.full_name}\n\nYou have saved N${newTotal.toLocaleString()} so far.\n${daysRemaining === 0 ? 'You have completed your 30 days! Your payout will be processed shortly.' : `${daysRemaining} days remaining. Keep going, you are almost there!`}`
  }

  if (message === 'FREEZE') {
    const { data: user } = await supabase
      .from('users')
      .select('id, full_name')
      .eq('whatsapp_number', whatsapp)
      .single()

    if (!user) {
      return `Sorry, I could not find your number. Please contact support immediately.`
    }

    await supabase
      .from('users')
      .update({ status: 'frozen' })
      .eq('id', user.id)

    return `Your MyAjo account has been frozen immediately ${user.full_name}. No transactions can be made until you contact our support team to unfreeze it.\n\nIf this was a mistake please contact us immediately.`
  }

  return `Sorry I did not understand that command.\n\nType HELP to see all available commands.`
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