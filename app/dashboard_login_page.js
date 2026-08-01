'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function DashboardLogin() {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const router = useRouter()

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')

    const response = await fetch('/api/dashboard-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    })

    if (response.ok) {
      router.push('/dashboard')
    } else {
      setError('Incorrect password. Please try again.')
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f9fafb', fontFamily: 'system-ui, sans-serif' }}>
      <form onSubmit={handleSubmit} style={{ background: 'white', padding: 32, borderRadius: 16, boxShadow: '0 1px 3px rgba(0,0,0,0.1)', width: 320 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: '#166534', marginBottom: 4 }}>MyAjo Dashboard</h1>
        <p style={{ fontSize: 14, color: '#6b7280', marginBottom: 20 }}>Enter the admin password to continue.</p>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          style={{ width: '100%', padding: '10px 14px', borderRadius: 8, border: '1px solid #d1d5db', fontSize: 14, marginBottom: 12 }}
          autoFocus
        />
        {error && <p style={{ color: '#dc2626', fontSize: 13, marginBottom: 12 }}>{error}</p>}
        <button type="submit" style={{ width: '100%', padding: '10px 14px', borderRadius: 8, background: '#166534', color: 'white', fontWeight: 600, fontSize: 14, border: 'none', cursor: 'pointer' }}>
          Log in
        </button>
      </form>
    </div>
  )
}
