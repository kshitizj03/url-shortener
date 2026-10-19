import { useEffect, useState } from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { api } from '../api'

function Breakdown({ title, rows }) {
  return (
    <div className="p-4 bg-gray-50 rounded-xl border border-gray-200">
      <h4 className="font-medium text-gray-800 mb-2">{title}</h4>
      {rows.length === 0 ? (
        <p className="text-sm text-gray-500">No data yet</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {rows.map((r) => (
            <li key={r.value ?? 'unknown'} className="flex justify-between gap-2">
              <span className="truncate">{r.value ?? 'Unknown'}</span>
              <span className="font-mono text-gray-600">{r.clicks}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function AnalyticsDashboard({ links, onDelete }) {
  // New links are added to the front, so following links[0] jumps to a link right after it is created.
  const newest = links[0]?.slug
  const [selected, setSelected] = useState(newest)
  useEffect(() => setSelected(newest), [newest])
  const link = links.find((l) => l.slug === selected) ?? links[0] // falls back if the selected one was deleted

  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!link) return
    let cancelled = false
    setLoading(true)
    setError(null)
    setStats(null)
    api(`/api/links/${link.slug}`, { token: link.manageToken })
      .then((data) => !cancelled && setStats(data))
      .catch((err) => !cancelled && setError(err.message))
      .finally(() => !cancelled && setLoading(false))
    return () => { cancelled = true }
  }, [link])

  const handleDelete = async () => {
    if (!confirm(`Delete ${link.shortUrl}? Its analytics are deleted too.`)) return
    setError(null)
    try {
      await api(`/api/links/${link.slug}`, { method: 'DELETE', token: link.manageToken })
    } catch (err) {
      // 404 means it is already gone (for example, taken down), so forget it locally anyway.
      if (err.status !== 404) return setError(err.message)
    }
    setStats(null)
    onDelete(link.slug)
  }

  if (links.length === 0) {
    return (
      <div className="p-8 bg-gray-50 rounded-xl border border-gray-200 text-center">
        <p className="text-gray-600">Links you create in this browser show up here with their stats.</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2 items-center">
        <label htmlFor="link-select" className="text-sm text-gray-700">Link</label>
        <select
          id="link-select"
          value={link.slug}
          onChange={(e) => setSelected(e.target.value)}
          className="flex-1 min-w-0 px-3 py-2 border border-gray-300 rounded-lg"
        >
          {links.map((l) => (
            <option key={l.slug} value={l.slug}>/{l.slug} → {l.url}</option>
          ))}
        </select>
        <button
          onClick={handleDelete}
          className="px-4 py-2 text-sm font-medium text-red-700 border border-red-200 rounded-lg hover:bg-red-50"
        >
          Delete
        </button>
      </div>

      {error && (
        <div role="alert" className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>
      )}

      {loading && !stats && <p className="text-gray-500">Loading...</p>}

      {stats && (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="p-6 bg-linear-to-br from-blue-500 to-blue-600 rounded-xl text-white">
              <p className="text-sm opacity-90">Human clicks, last {stats.days} days</p>
              <p className="text-4xl font-bold mt-1">{stats.clicks}</p>
            </div>
            <div className="p-6 bg-gray-50 rounded-xl border border-gray-200">
              <p className="text-sm text-gray-600">Bot and link-preview hits (not counted)</p>
              <p className="text-4xl font-bold mt-1 text-gray-700">{stats.botClicks}</p>
            </div>
          </div>

          <div className="p-4 bg-gray-50 rounded-xl border border-gray-200">
            <h3 className="font-medium text-gray-800 mb-4">Last {stats.days} days</h3>
            {/* The chart is visual only; screen readers get the same numbers as a table below. */}
            <div aria-hidden="true">
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={stats.daily}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                <XAxis dataKey="day" tick={{ fontSize: 12 }} tickFormatter={(d) => d.slice(5)} />
                <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                <Tooltip />
                <Line type="monotone" dataKey="clicks" stroke="#3B82F6" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
            </div>
            <table className="sr-only">
              <caption>Human clicks per day, last {stats.days} days</caption>
              <thead><tr><th scope="col">Day</th><th scope="col">Clicks</th></tr></thead>
              <tbody>
                {stats.daily.map((d) => <tr key={d.day}><td>{d.day}</td><td>{d.clicks}</td></tr>)}
              </tbody>
            </table>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Breakdown title="Countries" rows={stats.countries} />
            <Breakdown title="Referrers" rows={stats.referrers} />
            <Breakdown title="Devices" rows={stats.devices} />
            <Breakdown title="Browsers" rows={stats.browsers} />
          </div>
        </div>
      )}
    </div>
  )
}

export default AnalyticsDashboard
