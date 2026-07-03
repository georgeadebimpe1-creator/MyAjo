'use client'
import { useState } from 'react'
import { supabase } from '../lib/supabase'

export default function Balance() {
  const [whatsapp, setWhatsapp] = useState('')
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')

  async function handleCheck(e) {
    e.preventDefault()
    setLoading(true)
    setMessage('')
    setData(null)

    const { data: user, error: userError } = await supabase
      .from('users')
      .select('id, full_name, bank_name, bank_account_number')
      .eq('whatsapp_number', whatsapp)
      .single()

    if (userError || !user) {
      setMessage('WhatsApp number not found. Please register first.')
      setLoading(false)
      return
    }

    const { data: cycle, error: cycleError } = await supabase
      .from('cycles')
      .select('id, daily_amount, days_contributed, total_saved, commission, start_date, status')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .single()

    if (cycleError || !cycle) {
      setMessage('No active savings cycle found. Please start a cycle first.')
      setLoading(false)
      return
    }

    const { data: contributions } = await supabase
      .from('contributions')
      .select('contribution_date, amount')
      .eq('cycle_id', cycle.id)
      .order('contribution_date', { ascending: false })

    const daysRemaining = 30 - cycle.days_contributed
    const expectedTotal = parseFloat(cycle.total_saved) + (daysRemaining * parseFloat(cycle.daily_amount))
    const expectedPayout = expectedTotal - parseFloat(cycle.commission)

    setData({
      user,
      cycle,
      contributions: contributions || [],
      daysRemaining,
      expectedPayout,
    })
    setLoading(false)
  }

  function progressPercent(days) {
    return Math.min((days / 30) * 100, 100).toFixed(0)
  }

  return (
    <div className="min-h-screen bg-green-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-lg p-8 w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-green-800">MyAjo</h1>
          <p className="text-gray-500 mt-1">Check your savings balance</p>
        </div>

        {!data && (
          <form onSubmit={handleCheck} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Your WhatsApp Number</label>
              <input
                value={whatsapp}
                onChange={(e) => setWhatsapp(e.target.value)}
                required
                className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-green-500"
                placeholder="08012345678" />
            </div>
            <button type="submit" disabled={loading}
              className="w-full bg-green-700 text-white font-semibold py-3 rounded-lg hover:bg-green-800 transition">
              {loading ? 'Checking...' : 'Check My Balance'}
            </button>
            {message && <p className="text-center text-sm text-red-500 mt-2">{message}</p>}
          </form>
        )}

        {data && (
          <div className="space-y-4">
            <div className="bg-green-50 rounded-xl p-4">
              <p className="font-bold text-green-800 text-lg">Hello {data.user.full_name}</p>
              <p className="text-sm text-gray-500 mt-1">{data.user.bank_name} — {data.user.bank_account_number}</p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="bg-green-50 rounded-xl p-3 text-center">
                <p className="text-xs text-gray-500">Days Completed</p>
                <p className="text-2xl font-bold text-green-700">{data.cycle.days_contributed}</p>
                <p className="text-xs text-gray-400">of 30 days</p>
              </div>
              <div className="bg-blue-50 rounded-xl p-3 text-center">
                <p className="text-xs text-gray-500">Days Remaining</p>
                <p className="text-2xl font-bold text-blue-700">{data.daysRemaining}</p>
                <p className="text-xs text-gray-400">days to go</p>
              </div>
            </div>

            <div className="mt-2">
              <div className="flex justify-between text-xs text-gray-500 mb-1">
                <span>Progress</span>
                <span>{progressPercent(data.cycle.days_contributed)}% complete</span>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-3">
                <div
                  className="bg-green-600 h-3 rounded-full transition-all"
                  style={{ width: progressPercent(data.cycle.days_contributed) + '%' }}
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="bg-green-50 rounded-xl p-3">
                <p className="text-xs text-gray-500">Total Saved</p>
                <p className="text-sm font-bold text-green-700">₦{parseFloat(data.cycle.total_saved).toLocaleString()}</p>
              </div>
              <div className="bg-orange-50 rounded-xl p-3">
                <p className="text-xs text-gray-500">Commission</p>
                <p className="text-sm font-bold text-orange-600">₦{parseFloat(data.cycle.commission).toLocaleString()}</p>
              </div>
              <div className="bg-blue-50 rounded-xl p-3">
                <p className="text-xs text-gray-500">Est. Payout</p>
                <p className="text-sm font-bold text-blue-700">₦{data.expectedPayout.toLocaleString()}</p>
              </div>
            </div>

            {data.contributions.length > 0 && (
              <div>
                <p className="text-sm font-semibold text-gray-700 mb-2">Recent Contributions</p>
                <div className="space-y-2 max-h-40 overflow-y-auto">
                  {data.contributions.slice(0, 5).map((c, i) => (
                    <div key={i} className="flex justify-between text-sm bg-gray-50 rounded-lg px-3 py-2">
                      <span className="text-gray-500">{c.contribution_date}</span>
                      <span className="font-semibold text-green-700">₦{parseFloat(c.amount).toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <button
              onClick={() => { setData(null); setWhatsapp('') }}
              className="w-full border border-green-700 text-green-700 font-semibold py-3 rounded-lg hover:bg-green-50 transition mt-2">
              Check Another Number
            </button>
          </div>
        )}
      </div>
    </div>
  )
}