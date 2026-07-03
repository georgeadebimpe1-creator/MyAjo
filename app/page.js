'use client'
import { useState } from 'react'
import { supabase } from './lib/supabase'

export default function Register() {
  const [form, setForm] = useState({
    full_name: '',
    phone_number: '',
    whatsapp_number: '',
    bank_name: '',
    bank_account_number: '',
    bank_account_name: '',
    pin: '',
  })
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')

  function handleChange(e) {
    setForm({ ...form, [e.target.name]: e.target.value })
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true)
    setMessage('')

    const { error } = await supabase.from('users').insert([{
      full_name: form.full_name,
      phone_number: form.phone_number,
      whatsapp_number: form.whatsapp_number,
      bank_name: form.bank_name,
      bank_account_number: form.bank_account_number,
      bank_account_name: form.bank_account_name,
      pin_hash: form.pin,
    }])

    if (error) {
      setMessage('Registration failed: ' + error.message)
    } else {
      setMessage('Registration successful! Welcome to MyAjo.')
      setForm({ full_name: '', phone_number: '', whatsapp_number: '', bank_name: '', bank_account_number: '', bank_account_name: '', pin: '' })
    }
    setLoading(false)
  }

  return (
    <div className="min-h-screen bg-green-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-lg p-8 w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-green-800">MyAjo</h1>
          <p className="text-gray-500 mt-1">Your daily savings, safe and simple</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
            <input name="full_name" value={form.full_name} onChange={handleChange} required
              className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-green-500"
              placeholder="Your full name" />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Phone Number</label>
            <input name="phone_number" value={form.phone_number} onChange={handleChange} required
              className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-green-500"
              placeholder="08012345678" />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">WhatsApp Number</label>
            <input name="whatsapp_number" value={form.whatsapp_number} onChange={handleChange} required
              className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-green-500"
              placeholder="08012345678" />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Bank Name</label>
            <input name="bank_name" value={form.bank_name} onChange={handleChange} required
              className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-green-500"
              placeholder="First Bank" />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Account Number</label>
            <input name="bank_account_number" value={form.bank_account_number} onChange={handleChange} required
              className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-green-500"
              placeholder="0123456789" />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Account Name</label>
            <input name="bank_account_name" value={form.bank_account_name} onChange={handleChange} required
              className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-green-500"
              placeholder="As it appears on your bank account" />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Create a 4-digit PIN</label>
            <input name="pin" value={form.pin} onChange={handleChange} required maxLength={4} type="password"
              className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-green-500"
              placeholder="****" />
          </div>

          <button type="submit" disabled={loading}
            className="w-full bg-green-700 text-white font-semibold py-3 rounded-lg hover:bg-green-800 transition mt-2">
            {loading ? 'Registering...' : 'Register'}
          </button>

          {message && (
            <p className={`text-center text-sm mt-2 ${message.includes('successful') ? 'text-green-600' : 'text-red-500'}`}>
              {message}
            </p>
          )}
        </form>
      </div>
    </div>
  )
}