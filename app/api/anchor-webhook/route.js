import { NextResponse } from 'next/server'
import { supabase } from '../../lib/supabase'

// Anchor calls this when a real deposit lands in a trader's dedicated
// account. This REPLACES the manual "SAVE TRF123" flow — the balance only
// updates when Anchor confirms real money actually arrived, closing the
// gap where anyone could previously fake a SAVE message.
//
// ASSUMPTION, not yet confirmed: the exact event name and payload shape
// below (payin.received, data.relationships.account.data.id) are based on
// Anchor's documentation, not a real payload we've seen. The very first
// real webhook Anchor sends should be checked against this code.
export async function POST(request) {
  try {
    const payload = await request.json()

    if (payload.data?.type !== 'payin.received') {
      // Anchor may send other event types (account.opened, etc.) to the
      // same URL — quietly acknowledge anything that isn't a deposit.
      return new NextResponse('OK', { status: 200 })
    }

    const anchorAccountId = payload.data?.relationships?.account?.data?.id
    const amount = payload.data?.attributes?.amount // ASSUMPTION: in kobo — divide by 100 if so
    const amountNaira = amount ? amount / 100 : null

    if (!anchorAccountId || !amountNaira) {
      console.error('Anchor webhook: missing account or amount', JSON.stringify(payload))
      return new NextResponse('OK', { status: 200 })
    }

    // Match this deposit to the right trader via their Anchor account ID
    const { data: user } = await supabase
      .from('users')
      .select('id, full_name, whatsapp_number')
      .eq('anchor_account_id', anchorAccountId)
      .single()

    if (!user) {
      console.error('Anchor webhook: no user found for account', anchorAccountId)
      return new NextResponse('OK', { status: 200 })
    }

    const { data: cycle } = await supabase
      .from('cycles')
      .select('id, daily_amount, days_contributed, total_saved')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .single()

    if (!cycle) {
      console.error('Anchor webhook: no active cycle for user', user.id)
      return new NextResponse('OK', { status: 200 })
    }

    const today = new Date().toISOString().split('T')[0]

    // Record the contribution — verified: true, since this is a real,
    // Anchor-confirmed deposit rather than a self-reported claim.
    await supabase.from('contributions').insert([{
      cycle_id: cycle.id,
      user_id: user.id,
      amount: amountNaira,
      contribution_date: today,
      verified: true,
      contribution_type: 'daily',
    }])

    const newDays = cycle.days_contributed + 1
    const newTotal = parseFloat(cycle.total_saved) + amountNaira

    await supabase
      .from('cycles')
      .update({ days_contributed: newDays, total_saved: newTotal })
      .eq('id', cycle.id)

    // NOTE: this does not yet send Temi's WhatsApp confirmation message —
    // that needs to call the same sendMessage function from the main
    // webhook route. Worth wiring together once this is tested, so the
    // trader still gets their "Payment received, Day X of 30" message.

    return new NextResponse('OK', { status: 200 })
  } catch (error) {
    console.error('Anchor webhook error:', error)
    return new NextResponse('Error', { status: 500 })
  }
}
