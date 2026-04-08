import { useState } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts'

function AnalyticsDashboard({ apiUrl }) {
  const [shortCode, setShortCode] = useState('')
  const [analytics, setAnalytics] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const fetchAnalytics = async (e) => {
    e.preventDefault()
    if (!shortCode.trim()) return

    setLoading(true)
    setError(null)
    setAnalytics(null)

    try {
      const response = await fetch(`${apiUrl}/analytics/${shortCode.trim()}`)
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch analytics')
      }

      setAnalytics(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Search Form */}
      <form onSubmit={fetchAnalytics} className="flex gap-2">
        <input
          type="text"
          value={shortCode}
          onChange={(e) => setShortCode(e.target.value)}
          placeholder="Enter short code (e.g., abc123)"
          className="flex-1 px-4 py-3 border border-gray-300 rounded-lg
                     focus:ring-2 focus:ring-blue-500 focus:border-blue-500
                     outline-none transition-colors"
          disabled={loading}
        />
        <button
          type="submit"
          disabled={loading || !shortCode.trim()}
          className="px-6 py-3 bg-indigo-600 text-white font-medium rounded-lg
                     hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed
                     transition-colors"
        >
          {loading ? 'Loading...' : 'View Analytics'}
        </button>
      </form>

      {/* Error */}
      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
          <p className="font-medium">Error</p>
          <p className="text-sm">{error}</p>
        </div>
      )}

      {/* Analytics Data */}
      {analytics && (
        <div className="space-y-6">
          {/* URL Info */}
          <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <h3 className="font-medium text-blue-900">URL Details</h3>
            <p className="text-sm text-blue-700 mt-1 truncate">
              <span className="font-medium">Original:</span> {analytics.longUrl}
            </p>
            <p className="text-sm text-blue-700">
              <span className="font-medium">Created:</span>{' '}
              {new Date(analytics.createdAt).toLocaleDateString()}
            </p>
          </div>

          {/* Total Clicks */}
          <div className="p-6 bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl text-white max-w-md">
            <p className="text-sm opacity-80">Total Clicks</p>
            <p className="text-4xl font-bold mt-1">{analytics.totalClicks}</p>
          </div>

          {/* Clicks Over Time Chart */}
          {analytics.clicksOverTime?.length > 0 && (
            <div className="p-4 bg-gray-50 rounded-xl border border-gray-200">
              <h3 className="font-medium text-gray-800 mb-4">Clicks Over Time</h3>
              <ResponsiveContainer width="100%" height={250}>
                <LineChart data={analytics.clicksOverTime}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                  <XAxis 
                    dataKey="date" 
                    tick={{ fontSize: 12 }}
                    tickFormatter={(value) => {
                      const date = new Date(value)
                      return `${date.getMonth() + 1}/${date.getDate()}`
                    }}
                  />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: '#fff', 
                      border: '1px solid #E5E7EB',
                      borderRadius: '8px'
                    }}
                  />
                  <Line 
                    type="monotone" 
                    dataKey="count" 
                    stroke="#3B82F6" 
                    strokeWidth={2}
                    dot={{ fill: '#3B82F6' }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* No Data Message */}
          {analytics.totalClicks === 0 && (
            <div className="p-6 bg-gray-50 rounded-xl border border-gray-200 text-center">
              <p className="text-gray-500">No clicks recorded yet for this URL.</p>
              <p className="text-sm text-gray-400 mt-1">
                Share your short URL and check back later!
              </p>
            </div>
          )}
        </div>
      )}

      {/* Empty State */}
      {!analytics && !error && !loading && (
        <div className="p-8 bg-gray-50 rounded-xl border border-gray-200 text-center">
          <svg className="w-12 h-12 mx-auto text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
          <p className="mt-4 text-gray-600">Enter a short code to view analytics</p>
          <p className="text-sm text-gray-400 mt-1">
            View click statistics over time
          </p>
        </div>
      )}
    </div>
  )
}

export default AnalyticsDashboard
