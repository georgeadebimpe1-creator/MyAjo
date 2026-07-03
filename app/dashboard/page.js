'use client'
import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

export default function Dashboard() {
  const [stats, setStats] = useState({ totalTraders: 0, activeCycles: 0, totalSaved: 0, totalCommission: 0 })
  const [cycles, setCycles] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchDashboard()
  }, [])

  async function fetchDashboard() {
    setLoading(true)

    const { data: usersData } = await supabase
      .from('users')
      .select('id', { count: 'exact' })

    const { data: cyclesData } = await supabase
      .from('cycles')
      .select('id, daily_amount, days_contributed, total_saved, commission, status, start_date, users(full_name, whatsapp_number)')
      .eq('status', 'active')
      .order('start_date', { ascending: false })

    if (cyclesData) {
      const totalSaved = cyclesData.reduce((sum, c) => sum + parseFloat(c.total_saved || 0), 0)
      const totalCommission = cyclesData.reduce((sum, c) => sum + parseFloat(c.commission || 0), 0)
      setStats({
        totalTraders: usersData?.length || 0,
        activeCycles: cyclesData.length,
        totalSaved,
        totalCommission,
      })
      setCycles(cyclesData)
    }
    setLoading(false)
  }

  function progressPercent(days) {
    return Math.min((days / 30) * 100, 100).toFixed(0)
  }

  function expectedPayout(cycle) {
    const remaining = 30 - cycle.days_contributed
    const expectedTotal = parseFloat(cycle.total_saved) + (remaining * parseFloat(cycle.daily_amount))
    return (expectedTotal - parseFloat(cycle.commission)).toLocaleString()
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-green-700 font-semibold">Loading MyAjo dashboard...</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-6xl mx-auto">

        <div className="mb-8">
          <h1 className="text-3xl font-bold text-green-800">MyAjo</h1>
          <p className="text-gray-500 mt-1">Organiser Dashboard</p>
        </div>

        <div className="grid grid-cols-2 gap-4 mb-8 md:grid-cols-4">
          <div className="bg-white rounded-2xl p-5 shadow-sm">
            <p className="text-sm text-gray-500">Total Traders</p>
            <p className="text-3xl font-bold text-green-800 mt-1">{stats.totalTraders}</p>
          </div>
          <div className="bg-white rounded-2xl p-5 shadow-sm">
            <p className="text-sm text-gray-500">Active Cycles</p>
            <p className="text-3xl font-bold text-green-800 mt-1">{stats.activeCycles}</p>
          </div>
          <div className="bg-white rounded-2xl p-5 shadow-sm">
            <p className="text-sm text-gray-500">Total Saved</p>
            <p className="text-3xl font-bold text-green-800 mt-1">₦{stats.totalSaved.toLocaleString()}</p>
          </div>
          <div className="bg-white rounded-2xl p-5 shadow-sm">
            <p className="text-sm text-gray-500">Total Commission</p>
            <p className="text-3xl font-bold text-orange-600 mt-1">₦{stats.totalCommission.toLocaleString()}</p>
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-sm p-6">
          <h2 className="text-lg font-bold text-gray-800 mb-4">Active Savers</h2>
          {cycles.length === 0 ? (
            <p className="text-gray-400 text-sm">No active cycles yet.</p>
          ) : (
            <div className="space-y-4">
              {cycles.map((cycle) => (
                <div key={cycle.id} className="border border-gray-100 rounded-xl p-4">
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="font-semibold text-gray-800">{cycle.users?.full_name}</p>
                      <p className="text-sm text-gray-400">{cycle.users?.whatsapp_number}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold text-green-700">₦{parseFloat(cycle.daily_amount).toLocaleString()}/day</p>
                      <p className="text-xs text-gray-400">Started {cycle.start_date}</p>
                    </div>
                  </div>

                  <div className="mt-3">
                    <div className="flex justify-between text-xs text-gray-500 mb-1">
                      <span>Day {cycle.days_contributed} of 30</span>
                      <span>{progressPercent(cycle.days_contributed)}% complete</span>
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-2">
                      <div
                        className="bg-green-600 h-2 rounded-full transition-all"
                        style={{ width: progressPercent(cycle.days_contributed) + '%' }}
                      />
                    </div>
                  </div>

                  <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                    <div className="bg-green-50 rounded-lg p-2">
                      <p className="text-xs text-gray-500">Saved</p>
                      <p className="text-sm font-bold text-green-700">₦{parseFloat(cycle.total_saved).toLocaleString()}</p>
                    </div>
                    <div className="bg-orange-50 rounded-lg p-2">
                      <p className="text-xs text-gray-500">Commission</p>
                      <p className="text-sm font-bold text-orange-600">₦{parseFloat(cycle.commission).toLocaleString()}</p>
                    </div>
                    <div className="bg-blue-50 rounded-lg p-2">
                      <p className="text-xs text-gray-500">Expected Payout</p>
                      <p className="text-sm font-bold text-blue-700">₦{expectedPayout(cycle)}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="mt-4 text-center">
          <button onClick={fetchDashboard}
            className="text-sm text-green-700 underline">
            Refresh dashboard
          </button>
        </div>
      </div>
    </div>
  )
}