import { NextResponse } from 'next/server'
import { supabase } from '../../lib/supabase'

// Dojah calls this automatically once verification is complete.
// This is the trustworthy source of truth — not the widget's onSuccess
// in the browser, which only tells the TRADER it succeeded, not us.
export async function POST(request) {
  try {
    const payload = await request.json()

    // The trader's WhatsApp number, passed through as metadata when we
    // opened the widget, comes back to us here so we know whose result this is.
    const whatsapp = payload?.metadata?.user_id
    const govtData = payload?.data?.government_data || payload?.government_data

    if (!whatsapp) {
      console.error('Dojah webhook: no whatsapp number in metadata', JSON.stringify(payload))
      return new NextResponse('OK', { status: 200 })
    }

    const verified = payload?.status === 'completed' || payload?.verification_status === 'completed'

    if (verified && govtData) {
      // Upsert, not update — at this point in the flow the trader hasn't
      // confirmed their plan yet, so no user row exists. This creates one
      // if needed, or updates it if it somehow already does.
      await supabase
        .from('users')
        .upsert(
          {
            whatsapp_number: whatsapp,
            phone_number: whatsapp,
            kyc_status: 'verified',
            full_name: govtData.full_name || govtData.first_name + ' ' + govtData.last_name,
            date_of_birth: govtData.date_of_birth,
            gender: govtData.gender,
            residential_address: govtData.residential_address,
          },
          { onConflict: 'whatsapp_number' }
        )
    } else {
      await supabase
        .from('users')
        .upsert(
          { whatsapp_number: whatsapp, phone_number: whatsapp, kyc_status: 'failed' },
          { onConflict: 'whatsapp_number' }
        )
    }

    return new NextResponse('OK', { status: 200 })
  } catch (error) {
    console.error('Dojah webhook error:', error)
    return new NextResponse('Error', { status: 500 })
  }
}
