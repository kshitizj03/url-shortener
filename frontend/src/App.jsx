import { useState } from 'react'
import ShortenForm from './components/ShortenForm'
import ResultCard from './components/ResultCard'
import AnalyticsDashboard from './components/AnalyticsDashboard'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

function App() {
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)

  const handleShorten = async (longUrl) => {
    setLoading(true)
    setError(null)
    setResult(null)

    try {
      const response = await fetch(`${API_URL}/shorten`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url: longUrl }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to shorten URL')
      }

      setResult(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleReset = () => {
    setResult(null)
    setError(null)
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      {/* Header */}
      <header className="bg-white shadow-sm">
        <div className="max-w-4xl mx-auto px-4 py-6">
          <h1 className="text-3xl font-bold text-gray-900">
            URL Shortener
          </h1>
          <p className="mt-1 text-gray-600">
            Shorten long URLs with distributed ID generation
          </p>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-4xl mx-auto px-4 py-8 space-y-8">
        {/* Section 1: Shortener */}
        <section className="bg-white rounded-xl shadow-lg p-6">
          <h2 className="text-xl font-semibold text-gray-800 mb-4">
            Create Short URL
          </h2>
          
          {!result ? (
            <ShortenForm 
              onSubmit={handleShorten} 
              loading={loading} 
              error={error} 
            />
          ) : (
            <ResultCard 
              result={result} 
              onReset={handleReset} 
            />
          )}
        </section>

        {/* Section 2: Analytics */}
        <section className="bg-white rounded-xl shadow-lg p-6">
          <h2 className="text-xl font-semibold text-gray-800 mb-4">
            Analytics Dashboard
          </h2>
          <AnalyticsDashboard apiUrl={API_URL} />
        </section>
      </main>

      {/* Footer */}
      <footer className="max-w-4xl mx-auto px-4 py-6 text-center text-gray-500 text-sm">
        <p>
          Built with Snowflake IDs, Redis caching, and async analytics.
        </p>
        <p className="mt-1">
          <a 
            href={`${API_URL}/health`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 hover:underline"
          >
            Check API Health
          </a>
        </p>
      </footer>
    </div>
  )
}

export default App
