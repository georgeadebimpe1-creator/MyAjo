'use client'
// ===== The dashboard screen itself (do this one last) =====
// GitHub path: app/dashboard/page.js  (existing file: replace everything)
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

const LANGUAGES = { en: 'English', ha: 'Hausa', ig: 'Igbo', yo: 'Yoruba' }

const PAYOUT_TYPES = {
  early_partial: 'Early withdrawal',
  early_full: 'Early full withdrawal',
  cycle_completion: 'Day-30 payout',
  commission_collection: 'Commission collection',
}

function naira(value) {
  return '₦' + (Number(value) || 0).toLocaleString()
}

function dateOnly(iso) {
  return iso ? String(iso).slice(0, 10) : 'not yet'
}

function dateTime(iso) {
  return iso ? String(iso).slice(0, 16).replace('T', ' ') : 'not yet'
}

function Chip({ tone, children }) {
  const tones = {
    good: 'bg-green-50 text-green-700',
    warn: 'bg-orange-50 text-orange-700',
    bad: 'bg-red-50 text-red-700',
    neutral: 'bg-gray-100 text-gray-600',
  }
  return <span className={'text-xs font-medium rounded-full px-2 py-1 ' + (tones[tone] || tones.neutral)}>{children}</span>
}

function kycTone(status) {
  if (status === 'verified') return 'good'
  if (status === 'failed') return 'bad'
  return 'warn'
}

function payoutTone(status) {
  if (status === 'completed') return 'good'
  if (status === 'failed') return 'bad'
  return 'warn'
}

function TraderCard({ trader }) {
  const p = trader.profile
  return (
    <div className="border border-gray-200 rounded-2xl p-4 bg-white">
      <div className="flex justify-between items-start">
        <div>
          <p className="font-bold text-gray-800 text-lg">{p.fullName || 'No name yet'}</p>
          <p className="text-sm text-gray-500">WhatsApp {p.whatsappNumber}</p>
          {p.phoneNumber && p.phoneNumber !== p.whatsappNumber && (
            <p className="text-sm text-gray-500">Phone {p.phoneNumber}</p>
          )}
        </div>
        <p className="text-xs text-gray-400 text-right">{LANGUAGES[p.language] || p.language}</p>
      </div>

      <div className="flex flex-wrap gap-2 mt-3">
        <Chip tone={kycTone(p.kycStatus)}>Verification: {p.kycStatus || 'unknown'}</Chip>
        <Chip tone={p.accountStatus === 'active' ? 'good' : 'bad'}>Account: {p.accountStatus}</Chip>
        <Chip tone={p.depositAccountReady ? 'good' : 'warn'}>
          {p.depositAccountReady ? 'Savings account ready' : 'No savings account yet'}
        </Chip>
        <Chip tone={p.payoutBankReady ? 'good' : 'warn'}>
          {p.payoutBankReady ? 'Payout bank verified' : 'Payout bank not verified'}
        </Chip>
      </div>

      <div className="grid grid-cols-2 gap-2 mt-3 text-xs text-gray-500">
        <p>Joined: {dateOnly(p.signedUpAt)}</p>
        <p>Last wrote to Temi: {dateTime(p.lastMessageFromTraderAt)}</p>
        <p>Last payment: {dateOnly(trader.lastPaymentDate)}</p>
        <p>
          Bank: {p.bankName ? p.bankName + ' ' + (p.bankAccountMasked || '') : 'not added'}
        </p>
        {p.bankChangeFeeOwed > 0 && <p>Bank change fee owed: {naira(p.bankChangeFeeOwed)}</p>}
      </div>

      <h3 className="text-sm font-bold text-gray-700 mt-4 mb-2">Cycles</h3>
      {trader.cycles.length === 0 ? (
        <p className="text-sm text-gray-400">No cycles yet.</p>
      ) : (
        <div className="space-y-2">
          {trader.cycles.map((c) => (
            <div key={c.id} className="bg-gray-50 rounded-xl p-3">
              <div className="flex justify-between text-sm">
                <span className="font-semibold text-gray-700">
                  {naira(c.dailyAmount)}/day, started {dateOnly(c.startDate)}
                </span>
                <Chip tone={c.status === 'active' ? 'good' : 'neutral'}>{c.status}</Chip>
              </div>
              {c.status === 'active' && (
                <p className="text-xs text-gray-500 mt-1">
                  Day {c.cycleDayNumber} of 30, paid {c.daysContributed} {c.daysContributed === 1 ? 'day' : 'days'}.{' '}
                  {c.withdrawalsUnlocked ? 'Withdrawals are open.' : 'Withdrawals locked until day 10.'}
                </p>
              )}
              <div className="grid grid-cols-3 gap-2 mt-2 text-center">
                <div className="bg-white rounded-lg p-2">
                  <p className="text-xs text-gray-500">Saved</p>
                  <p className="text-sm font-bold text-green-700">{naira(c.totalSaved)}</p>
                </div>
                <div className="bg-white rounded-lg p-2">
                  <p className="text-xs text-gray-500">Commission held</p>
                  <p className="text-sm font-bold text-orange-600">{naira(c.commission)}</p>
                </div>
                <div className="bg-white rounded-lg p-2">
                  <p className="text-xs text-gray-500">Can withdraw now</p>
                  <p className="text-sm font-bold text-blue-700">
                    {c.withdrawableNow === null ? '-' : naira(c.withdrawableNow)}
                  </p>
                </div>
              </div>
              {c.partialWithdrawals > 0 && (
                <p className="text-xs text-gray-400 mt-1">Withdrawals taken so far: {c.partialWithdrawals}</p>
              )}
            </div>
          ))}
        </div>
      )}

      <h3 className="text-sm font-bold text-gray-700 mt-4 mb-2">Payouts</h3>
      {trader.payouts.length === 0 ? (
        <p className="text-sm text-gray-400">No payouts yet.</p>
      ) : (
        <div className="space-y-2">
          {trader.payouts.map((o) => (
            <div key={o.id} className="text-sm border-b border-gray-100 pb-2">
              <div className="flex justify-between">
                <span className="text-gray-700">{PAYOUT_TYPES[o.type] || o.type}</span>
                <Chip tone={payoutTone(o.status)}>{o.status}</Chip>
              </div>
              <p className="text-xs text-gray-500">
                {dateTime(o.initiatedAt)}. Taken from savings {naira(o.grossAmount)}, sent to trader {naira(o.netAmount)}
                {o.fee > 0 ? ', banking fees ' + naira(o.fee) : ''}
                {o.commission > 0 ? ', commission ' + naira(o.commission) + (o.commissionMoved ? ' (moved to MyAjo)' : ' (not moved)') : ''}
              </p>
              {o.failedReason && <p className="text-xs text-red-600">Reason: {o.failedReason}</p>}
            </div>
          ))}
        </div>
      )}

      <h3 className="text-sm font-bold text-gray-700 mt-4 mb-2">Recent payments</h3>
      {trader.recentContributions.length === 0 ? (
        <p className="text-sm text-gray-400">No payments yet.</p>
      ) : (
        <div className="space-y-1">
          {trader.recentContributions.map((c, i) => (
            <p key={i} className="text-xs text-gray-600">
              {dateOnly(c.date)}: {naira(c.amount)} {c.verified ? '' : '(not verified)'}
            </p>
          ))}
        </div>
      )}

      <h3 className="text-sm font-bold text-gray-700 mt-4 mb-1">Messages Temi sent</h3>
      <p className="text-xs text-gray-400 mb-2">Only the type and time are recorded, not the words.</p>
      {trader.recentMessages.length === 0 ? (
        <p className="text-sm text-gray-400">None recorded.</p>
      ) : (
        <div className="space-y-1">
          {trader.recentMessages.map((m, i) => (
            <p key={i} className="text-xs text-gray-600">
              {dateTime(m.sentAt)}: {m.type} ({m.method})
            </p>
          ))}
        </div>
      )}
    </div>
  )
}

export default function Dashboard() {
  const [stats, setStats] = useState({ totalTraders: 0, activeCycles: 0, totalSaved: 0, commissionOnActiveCycles: 0 })
  const [cycles, setCycles] = useState([])
  const [attention, setAttention] = useState(null)
  const [attentionError, setAttentionError] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [results, setResults] = useState(null)

  const [openCategory, setOpenCategory] = useState(null)
  const router = useRouter()

  useEffect(() => {
    fetchDashboard()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Everything comes from our own server routes (which use the admin
  // database connection) instead of the browser talking to the database.
  async function fetchDashboard() {
    setLoading(true)
    setError('')
    setAttentionError('')

    try {
      const [dataRes, attentionRes] = await Promise.all([
        fetch('/api/dashboard-data', { cache: 'no-store' }),
        fetch('/api/dashboard-attention', { cache: 'no-store' }),
      ])

      if (dataRes.status === 401 || attentionRes.status === 401) {
        router.push('/dashboard-login')
        return
      }

      if (dataRes.ok) {
        const data = await dataRes.json()
        setStats(data.stats)
        setCycles(data.cycles)
      } else {
        setError('The dashboard could not load its totals. Please refresh, and if it keeps happening, check the Vercel logs.')
      }

      if (attentionRes.ok) {
        setAttention(await attentionRes.json())
      } else {
        setAttentionError('The needs-attention list could not load. Please refresh, and if it keeps happening, check the Vercel logs.')
      }
    } catch (err) {
      setError('The dashboard could not reach the server. Please check your connection and refresh.')
    }

    setLoading(false)
  }

  async function runSearch(text) {
    const q = (text !== undefined ? text : query).trim()
    if (!q) return

    setQuery(q)
    setSearching(true)
    setSearchError('')

    try {
      const response = await fetch('/api/dashboard-lookup?q=' + encodeURIComponent(q), { cache: 'no-store' })

      if (response.status === 401) {
        router.push('/dashboard-login')
        return
      }

      const body = await response.json().catch(() => ({}))

      if (!response.ok) {
        setResults(null)
        setSearchError(body.error || 'The search failed. Please try again.')
      } else {
        setResults(body.results)
        if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' })
      }
    } catch (err) {
      setResults(null)
      setSearchError('The search could not reach the server. Please check your connection.')
    }

    setSearching(false)
  }

  function clearSearch() {
    setQuery('')
    setResults(null)
    setSearchError('')
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

        <div className="mb-6">
          <h1 className="text-3xl font-bold text-green-800">MyAjo</h1>
          <p className="text-gray-500 mt-1">Organiser Dashboard</p>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl p-4 mb-6">{error}</div>
        )}

        {/* ---------- Trader lookup ---------- */}
        <div className="bg-white rounded-2xl shadow-sm p-5 mb-6">
          <h2 className="text-lg font-bold text-gray-800 mb-1">Find a trader</h2>
          <p className="text-xs text-gray-400 mb-3">Type a phone number (at least 6 digits) or part of a name.</p>
          <div className="flex gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') runSearch() }}
              placeholder="0803... or Amina"
              className="flex-1 border border-gray-300 rounded-xl px-3 py-2 text-sm"
            />
            <button
              onClick={() => runSearch()}
              disabled={searching}
              className="bg-green-700 text-white text-sm font-medium rounded-xl px-4 py-2 disabled:opacity-60"
            >
              {searching ? 'Searching...' : 'Find'}
            </button>
          </div>

          {searchError && <p className="text-sm text-red-600 mt-3">{searchError}</p>}

          {results !== null && (
            <div className="mt-4">
              <div className="flex justify-between items-center mb-3">
                <p className="text-sm text-gray-500">
                  {results.length === 0 ? 'No trader found.' : results.length + (results.length === 1 ? ' trader found' : ' traders found')}
                </p>
                <button onClick={clearSearch} className="text-sm text-green-700 underline">Clear</button>
              </div>
              <div className="space-y-4">
                {results.map((t) => <TraderCard key={t.profile.id} trader={t} />)}
              </div>
            </div>
          )}
        </div>

        {/* ---------- Needs attention ---------- */}
        <div className="bg-white rounded-2xl shadow-sm p-5 mb-6">
          <div className="flex justify-between items-center mb-3">
            <h2 className="text-lg font-bold text-gray-800">Needs attention</h2>
            {attention && (
              <Chip tone={attention.total === 0 ? 'good' : 'warn'}>
                {attention.total === 0 ? 'All clear' : attention.total + ' to look at'}
              </Chip>
            )}
          </div>

          {attentionError && <p className="text-sm text-red-600">{attentionError}</p>}

          {attention && attention.total === 0 && (
            <p className="text-sm text-gray-400">Nothing needs you right now.</p>
          )}

          {attention && attention.categories.filter((c) => c.count > 0).map((cat) => (
            <div key={cat.key} className="border-t border-gray-100 py-3">
              <button
                onClick={() => setOpenCategory(openCategory === cat.key ? null : cat.key)}
                className="w-full flex justify-between items-center text-left"
              >
                <span className="text-sm font-semibold text-gray-700">{cat.title}</span>
                <span className="flex items-center gap-2">
                  <Chip tone="warn">{cat.count}</Chip>
                  <span className="text-gray-400 text-sm">{openCategory === cat.key ? '-' : '+'}</span>
                </span>
              </button>
              <p className="text-xs text-gray-400 mt-1">{cat.hint}</p>

              {openCategory === cat.key && (
                <div className="mt-3 space-y-3">
                  {cat.items.map((item, i) => (
                    <div key={i} className="bg-gray-50 rounded-xl p-3">
                      <div className="flex justify-between items-start gap-2">
                        <div>
                          <p className="text-sm font-semibold text-gray-800">{item.name}</p>
                          <p className="text-xs text-gray-500">{item.whatsapp}</p>
                        </div>
                        <button
                          onClick={() => runSearch(item.whatsapp)}
                          className="text-xs text-green-700 underline shrink-0"
                        >
                          Look up
                        </button>
                      </div>
                      <p className="text-xs text-gray-600 mt-1">{item.detail}</p>
                    </div>
                  ))}
                  {cat.count > cat.items.length && (
                    <p className="text-xs text-gray-400">Showing the first {cat.items.length} of {cat.count}.</p>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* ---------- Totals ---------- */}
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

        {/* ---------- Active savers ---------- */}
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
          <button onClick={fetchDashboard} className="text-sm text-green-700 underline">
            Refresh dashboard
          </button>
        </div>
      </div>
    </div>
  )
                          }
