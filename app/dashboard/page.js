'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function Dashboard() {
  const [stats, setStats] = useState({ totalTraders: 0, activeCycles: 0, totalSaved: 0, commissionOnActiveCycles: 0 })
  const [cycles, setCycles] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const router = useRouter()

  useEffect(() => {
    fetchDashboard()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Data now comes from our own server route (which uses the admin database
  // connection) instead of the browser talking to the database directly.
  async function fetchDashboard() {
    setLoading(true)
    setError('')

    try {
      const response = await fetch('/api/dashboard-data', { cache: 'no-store' })

      if (response.status === 401) {
        router.push('/dashboard-login')
        return
      }

      if (!response.ok) {
        setError('The dashboard could not load its data. Please refresh, and if it keeps happening, check the Vercel logs.')
        setLoading(false)
        return
      }

      const data = await response.json()
      setStats(data.stats)
      setCycles(data.cycles)
    } catch (err) {
      setError('The dashboard could not reach the server. Please check your connection and refresh.')
    }

    setLoading(false)
  }

  function progressPercent(day) {
    return Math.min((day / 30) * 100, 100).toFixed(0)
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

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl p-4 mb-6">
            {error}
          </div>
        )}

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
            <p className="text-sm text-gray-500">Commission on Active Cycles</p>
            <p className="text-3xl font-bold text-orange-600 mt-1">₦{stats.commissionOnActiveCycles.toLocaleString()}</p>
            <p className="text-xs text-gray-400 mt-1">Set at cycle start, not yet earned</p>
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
                      <p className="font-semibold text-gray-800">{cycle.fullName}</p>
                      <p className="text-sm text-gray-400">{cycle.whatsappNumber}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold text-green-700">₦{cycle.dailyAmount.toLocaleString()}/day</p>
                      <p className="text-xs text-gray-400">Started {cycle.startDate}</p>
                    </div>
                  </div>

                  <div className="mt-3">
                    <div className="flex justify-between text-xs text-gray-500 mb-1">
                      <span>Day {cycle.cycleDayNumber} of 30 (paid {cycle.daysContributed} {cycle.daysContributed === 1 ? 'day' : 'days'})</span>
                      <span>{progressPercent(cycle.cycleDayNumber)}% of cycle passed</span>
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-2">
                      <div
                        className="bg-green-600 h-2 rounded-full transition-all"
                        style={{ width: progressPercent(cycle.cycleDayNumber) + '%' }}
                      />
                    </div>
                  </div>

                  <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                    <div className="bg-green-50 rounded-lg p-2">
                      <p className="text-xs text-gray-500">Saved</p>
                      <p className="text-sm font-bold text-green-700">₦{cycle.totalSaved.toLocaleString()}</p>
                    </div>
                    <div className="bg-orange-50 rounded-lg p-2">
                      <p className="text-xs text-gray-500">Commission</p>
                      <p className="text-sm font-bold text-orange-600">₦{cycle.commission.toLocaleString()}</p>
                    </div>
                    <div className="bg-blue-50 rounded-lg p-2">
                      <p className="text-xs text-gray-500">Expected Payout</p>
                      <p className="text-sm font-bold text-blue-700">₦{cycle.expectedPayout.toLocaleString()}</p>
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
