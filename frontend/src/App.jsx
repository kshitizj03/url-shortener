import { useState } from 'react'
import ShortenForm from './components/ShortenForm'
import ResultCard from './components/ResultCard'
import AnalyticsDashboard from './components/AnalyticsDashboard'
import { loadLinks, saveLinks } from './myLinks'

// Same origin in production (the Worker serves this app); Vite proxies /api in dev.
const API_URL = import.meta.env.VITE_API_URL || ''

function App() {
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
  const [links, setLinks] = useState(loadLinks)

  const updateLinks = (next) => {
    setLinks(next)
    saveLinks(next)
  }

  const handleShorten = async ({ url, slug, expiresAt }) => {
    setLoading(true)
    setError(null)
    setResult(null)

    try {
      const response = await fetch(`${API_URL}/api/links`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, slug: slug || undefined, expiresAt: expiresAt || undefined }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Failed to shorten URL')

      setResult(data)
      updateLinks([data, ...links])
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      <header className="bg-white shadow-sm">
        <div className="max-w-4xl mx-auto px-4 py-6">
          <h1 className="text-3xl font-bold text-gray-900">URL Shortener</h1>
          <p className="mt-1 text-gray-600">Short links with bot-filtered, privacy-friendly analytics</p>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8 space-y-8">
        <section className="bg-white rounded-xl shadow-lg p-6">
          <h2 className="text-xl font-semibold text-gray-800 mb-4">Create Short URL</h2>
          {!result ? (
            <ShortenForm onSubmit={handleShorten} loading={loading} error={error} />
          ) : (
            <ResultCard result={result} onReset={() => setResult(null)} />
          )}
        </section>

        <section className="bg-white rounded-xl shadow-lg p-6">
          <h2 className="text-xl font-semibold text-gray-800 mb-4">My Links</h2>
          <AnalyticsDashboard
            apiUrl={API_URL}
            links={links}
            onDelete={(slug) => updateLinks(links.filter((l) => l.slug !== slug))}
          />
        </section>
      </main>

      <footer className="max-w-4xl mx-auto px-4 py-6 text-center text-gray-500 text-sm">
        <p>Runs on one Cloudflare Worker with D1. No IP addresses are stored.</p>
      </footer>
    </div>
  )
}

export default App
