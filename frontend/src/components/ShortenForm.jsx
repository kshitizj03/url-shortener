import { useState } from 'react'

function ShortenForm({ onSubmit, loading, error }) {
  const [url, setUrl] = useState('')

  const handleSubmit = (e) => {
    e.preventDefault()
    if (url.trim()) {
      onSubmit(url.trim())
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label 
          htmlFor="url" 
          className="block text-sm font-medium text-gray-700 mb-1"
        >
          Enter your long URL
        </label>
        <div className="flex gap-2">
          <input
            type="url"
            id="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com/very/long/path/to/shorten"
            className="flex-1 px-4 py-3 border border-gray-300 rounded-lg 
                       focus:ring-2 focus:ring-blue-500 focus:border-blue-500
                       outline-none transition-colors"
            required
            disabled={loading}
          />
          <button
            type="submit"
            disabled={loading || !url.trim()}
            className="px-6 py-3 bg-blue-600 text-white font-medium rounded-lg
                       hover:bg-blue-700 focus:ring-2 focus:ring-blue-500 
                       focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed
                       transition-colors"
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                  <circle 
                    className="opacity-25" 
                    cx="12" cy="12" r="10" 
                    stroke="currentColor" 
                    strokeWidth="4"
                    fill="none"
                  />
                  <path 
                    className="opacity-75" 
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                  />
                </svg>
                Shortening...
              </span>
            ) : (
              'Shorten'
            )}
          </button>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
          <p className="font-medium">Error</p>
          <p className="text-sm">{error}</p>
        </div>
      )}

      <p className="text-sm text-gray-500">
        Paste a long URL and get a short, shareable link instantly.
      </p>
    </form>
  )
}

export default ShortenForm
