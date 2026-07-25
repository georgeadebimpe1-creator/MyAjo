'use client'

import { useEffect, useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import Script from 'next/script'

// This page is what Temi links traders to during registration.
// It loads Dojah's verification widget, tied to their WhatsApp number
// so we know whose result it is when Dojah reports back.

function VerifyContent() {
  const searchParams = useSearchParams()
  const whatsapp = searchParams.get('ref') // trader's WhatsApp number, passed in the link
  const [status, setStatus] = useState('loading') // loading, ready, success, error

  useEffect(() => {
    if (typeof window === 'undefined' || !window.Connect) return

    const options = {
      app_id: process.env.NEXT_PUBLIC_DOJAH_APP_ID,
      p_key: process.env.NEXT_PUBLIC_DOJAH_PUBLIC_KEY,
      type: 'custom',
      metadata: {
        user_id: whatsapp, // this is how we match the result back to the right trader
      },
      config: {
        widget_id: process.env.NEXT_PUBLIC_DOJAH_WIDGET_ID,
      },
      onSuccess: function (response) {
        setStatus('success')
      },
      onError: function (err) {
        console.error('Dojah error:', err)
        setStatus('error')
      },
      onClose: function () {
        // Trader closed the widget without finishing — leave status as is
      },
    }

    const connect = new window.Connect(options)
    connect.setup()
    connect.open()
    setStatus('ready')
  }, [whatsapp])

  if (!whatsapp) {
    return (
      <div style={{ padding: 40, textAlign: 'center', fontFamily: 'Arial' }}>
        <p>This verification link is missing some information. Please go back to WhatsApp and tap the link Temi sent you again.</p>
      </div>
    )
  }

  return (
    <div style={{ padding: 40, textAlign: 'center', fontFamily: 'Arial' }}>
      <Script src="https://widget.dojah.io/widget.js" strategy="afterInteractive" />
      {status === 'loading' && <p>Loading verification...</p>}
      {status === 'success' && (
        <div>
          <h2>Verification submitted!</h2>
          <p>Go back to WhatsApp and type DONE to continue.</p>
        </div>
      )}
      {status === 'error' && (
        <div>
          <h2>Something went wrong</h2>
          <p>Please try again, or go back to WhatsApp and type DONE and Temi will let you know if it's still processing.</p>
        </div>
      )}
    </div>
  )
}

export default function VerifyPage() {
  return (
    <Suspense fallback={<div style={{ padding: 40, textAlign: 'center' }}>Loading...</div>}>
      <VerifyContent />
    </Suspense>
  )
}
