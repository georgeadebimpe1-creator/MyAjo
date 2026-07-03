'use client'
import { useState } from 'react'
import { supabase } from '../lib/supabase'

export default function StartCycle() {
  const [form, setForm] = useState({
    whatsapp_number: '',
    daily_amount: '',
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

    const { data: user, error: userError } = await supabase
      .from('users')
      .select('id')
      .eq('whatsapp_number', form.whatsapp_number)
      .single()

    if (userError || !user) {
      setMessage('WhatsApp number not found. Please register first.')
      setLoading(false)
      return
    }

    const { data: existingCycle } = await supabase
      .from('cycles')
      .select('id')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .single()

    if (existingCycle) {
      setMessage('You already have an active savings cycle running.')
      setLoading(false)
      return
    }

    const dailyAmount = parseFloat(form.daily_amount)
    const { error: cycleError } = await supabase
      .from('cycles')
      .insert([{
        user_id: user.id,
        daily_amount: dailyAmount,
        commission: dailyAmount,
        status: 'active',
        start_date: new Date().toISOString().split('T')[0],
      }])

    if (cycleError) {
      setMessage('Could not start cycle: ' + cycleError.message)
    } else {
      setMessage('Your 30-day savings cycle has started! Save ₦' + dailyAmount.toLocaleString() + ' every day.')
      setForm({ whatsapp_number: '', daily_amount: '' })
    }
    setLoading(false)
  }

  return (
    <div className="min-h-screen bg-green-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-lg p-8 w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-green-800">MyAjo</h1>
          <p className="text-gray-500 mt-1">Start your savings cycle</p>
        </div>

        <div className="bg-green-50 rounded-xl p-4 mb-6">
          <p className="text-sm text-green-800 font-medium">How it works</p>
          <p className="text-sm text-gray-600 mt-1">Choose your daily amount. Save every day for 30 days. Collect your payout at the end minus one day as commission. Simple.</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Your WhatsApp Number</label>
            <input name="whatsapp_number" value={form.whatsapp_number} onChange={handleChange} required
              className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-green-500"
              placeholder="08012345678" />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Daily Savings Amount (₦)</label>
            <input name="daily_amount" value={form.daily_amount} onChange={handleChange} required
              type="number" min="200" max="50000"
              className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-green-500"
              placeholder="e.g. 1000" />
          </div>

          {form.daily_amount && (
            <div className="bg-navy-50 bg-blue-50 rounded-xl p-4">
              <p className="text-sm text-gray-600">If you save <span className="font-bold text-green-700">₦{parseFloat(form.daily_amount || 0).toLocaleString()}</span> every day for 30 days</p>
              <p className="text-sm text-gray-600 mt-1">Total saved: <span className="font-bold">₦{(parseFloat(form.daily_amount || 0) * 30).toLocaleString()}</span></p>
              <p className="text-sm text-gray-600 mt-1">Commission: <span className="font-bold text-orange-600">₦{parseFloat(form.daily_amount || 0).toLocaleString()}</span></p>
              <p className="text-sm text-gray-600 mt-1">You receive: <span className="font-bold text-green-700">₦{(parseFloat(form.daily_amount || 0) * 29).toLocaleString()}</span></p>
            </div>
          )}

          <button type="submit" disabled={loading}
            className="w-full bg-green-700 text-white font-semibold py-3 rounded-lg hover:bg-green-800 transition mt-2">
            {loading ? 'Starting your cycle...' : 'Start Saving'}
          </button>

          {message && (
            <p className={`text-center text-sm mt-2 ${message.includes('started') ? 'text-green-600' : 'text-red-500'}`}>
              {message}
            </p>
          )}
        </form>
      </div>
    </div>
  )
}