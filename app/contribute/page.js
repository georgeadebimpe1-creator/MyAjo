'use client'
import { useState } from 'react'
import { supabase } from '../lib/supabase'

export default function Contribute() {
  const [form, setForm] = useState({ whatsapp_number: '', payment_reference: '' })
  const [cycle, setCycle] = useState(null)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [step, setStep] = useState('lookup')

  function handleChange(e) {
    setForm({ ...form, [e.target.name]: e.target.value })
  }

  async function handleLookup(e) {
    e.preventDefault()
    setLoading(true)
    setMessage('')
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('id, full_name')
      .eq('whatsapp_number', form.whatsapp_number)
      .single()
    if (userError || !user) {
      setMessage('WhatsApp number not found. Please register first.')
      setLoading(false)
      return
    }
    const { data: activeCycle, error: cycleError } = await supabase
      .from('cycles')
      .select('id, daily_amount, days_contributed, total_saved, commission, start_date')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .single()
    if (cycleError || !activeCycle) {
      setMessage('No active savings cycle found. Please start a cycle first.')
      setLoading(false)
      return
    }
    const today = new Date().toISOString().split('T')[0]
    const { data: alreadyPaid } = await supabase
      .from('contributions')
      .select('id')
      .eq('cycle_id', activeCycle.id)
      .eq('contribution_date', today)
      .single()
    if (alreadyPaid) {
      setMessage('You have already recorded your contribution for today. Well done!')
      setLoading(false)
      return
    }
    setCycle({ ...activeCycle, user_id: user.id, full_name: user.full_name })
    setStep('confirm')
    setLoading(false)
  }

  async function handleContribute(e) {
    e.preventDefault()
    setLoading(true)
    setMessage('')
    const today = new Date().toISOString().split('T')[0]
    const { error: contribError } = await supabase
      .from('contributions')
      .insert([{
        cycle_id: cycle.id,
        user_id: cycle.user_id,
        amount: cycle.daily_amount,
        contribution_date: today,
        payment_reference: form.payment_reference,
        verified: false,
        contribution_type: 'daily',
      }])
    if (contribError) {
      setMessage('Could not record contribution: ' + contribError.message)
      setLoading(false)
      return
    }
    const newDays = cycle.days_contributed + 1
    const newTotal = parseFloat(cycle.total_saved) + parseFloat(cycle.daily_amount)
    await supabase
      .from('cycles')
      .update({ days_contributed: newDays, total_saved: newTotal })
      .eq('id', cycle.id)
    setMessage('Day ' + newDays + ' recorded! You have saved ₦' + newTotal.toLocaleString() + ' so far. Keep going!')
    setStep('done')
    setLoading(false)
  }

  function reset() {
    setForm({ whatsapp_number: '', payment_reference: '' })
    setCycle(null)
    setMessage('')
    setStep('lookup')
  }

  return (
    <div className="min-h-screen bg-green-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-lg p-8 w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-green-800">MyAjo</h1>
          <p className="text-gray-500 mt-1">Record your daily contribution</p>
        </div>

        {step === 'lookup' && (
          <form onSubmit={handleLookup} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Your WhatsApp Number</label>
              <input name="whatsapp_number" value={form.whatsapp_number} onChange={handleChange} required
                className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-green-500"
                placeholder="08012345678" />
            </div>
            <button type="submit" disabled={loading}
              className="w-full bg-green-700 text-white font-semibold py-3 rounded-lg hover:bg-green-800 transition">
              {loading ? 'Checking...' : 'Check My Cycle'}
            </button>
            {message && <p className="text-center text-sm text-red-500 mt-2">{message}</p>}
          </form>
        )}

        {step === 'confirm' && cycle && (
          <form onSubmit={handleContribute} className="space-y-4">
            <div className="bg-green-50 rounded-xl p-4">
              <p className="text-sm font-bold text-green-800">Hello {cycle.full_name}</p>
              <p className="text-sm text-gray-600 mt-2">Day <span className="font-bold text-green-700">{cycle.days_contributed + 1}</span> of 30</p>
              <p className="text-sm text-gray-600 mt-1">Today's amount: <span className="font-bold">₦{parseFloat(cycle.daily_amount).toLocaleString()}</span></p>
              <p className="text-sm text-gray-600 mt-1">Total saved so far: <span className="font-bold">₦{parseFloat(cycle.total_saved).toLocaleString()}</span></p>
              <p className="text-sm text-gray-600 mt-1">Days remaining: <span className="font-bold text-orange-600">{30 - cycle.days_contributed - 1}</span></p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Bank Transfer Reference</label>
              <input name="payment_reference" value={form.payment_reference} onChange={handleChange} required
                className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-green-500"
                placeholder="Enter your transfer reference number" />
              <p className="text-xs text-gray-400 mt-1">This is the reference from your bank transfer confirmation</p>
            </div>
            <button type="submit" disabled={loading}
              className="w-full bg-green-700 text-white font-semibold py-3 rounded-lg hover:bg-green-800 transition">
              {loading ? 'Recording...' : 'Record Day ' + (cycle.days_contributed + 1) + ' Contribution'}
            </button>
            {message && <p className="text-center text-sm text-red-500 mt-2">{message}</p>}
          </form>
        )}

        {step === 'done' && (
          <div className="text-center space-y-4">
            <div className="text-5xl mb-4">✓</div>
            <p className="text-green-700 font-semibold text-lg">{message}</p>
            <button onClick={reset}
              className="w-full bg-green-700 text-white font-semibold py-3 rounded-lg hover:bg-green-800 transition mt-4">
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  )
}