// Loaded on demand by AnalyticsDashboard (React.lazy), so Recharts, most of the app's JS,
// is only downloaded once someone opens a link's stats.
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'

const CHART_HEIGHT = 250 // AnalyticsDashboard's loading placeholder uses the same height

export default function ClicksChart({ daily }) {
  return (
    <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
      <LineChart data={daily}>
        <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
        <XAxis dataKey="day" tick={{ fontSize: 12 }} tickFormatter={(d) => d.slice(5)} />
        <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
        <Tooltip />
        <Line type="monotone" dataKey="clicks" stroke="#3B82F6" strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  )
}
