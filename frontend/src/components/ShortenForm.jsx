import { useState } from 'react'

const inputClass = `px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500
                    focus:border-blue-500 outline-none transition-colors`

function ShortenForm({ onSubmit, loading, error }) {
  const [url, setUrl] = useState('')
  const [slug, setSlug] = useState('')
  const [expires, setExpires] = useState('')

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!url.trim()) return
    onSubmit({
      url: url.trim(),
      slug: slug.trim(),
      // datetime-local has no zone; Date() reads it as local time, toISOString makes it UTC.
      expiresAt: expires ? new Date(expires).toISOString() : '',
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="url" className="block text-sm font-medium text-gray-700 mb-1">
          Enter your long URL
        </label>
        <div className="flex gap-2">
          <input
            type="url"
            id="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com/very/long/path/to/shorten"
            className={`flex-1 ${inputClass}`}
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
            {loading ? 'Shortening...' : 'Shorten'}
          </button>
        </div>
      </div>

      <details className="text-sm">
        <summary className="cursor-pointer text-gray-600">Custom slug and expiry</summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-gray-700">
            Custom slug (optional)
            <input
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="my-launch"
              pattern="[A-Za-z0-9_\-]{3,32}"
              title="3-32 letters, digits, - or _"
              className={inputClass}
              disabled={loading}
            />
          </label>
          <label className="flex flex-col gap-1 text-gray-700">
            Expires (optional)
            <input
              type="datetime-local"
              value={expires}
              onChange={(e) => setExpires(e.target.value)}
              className={inputClass}
              disabled={loading}
            />
          </label>
        </div>
      </details>

      {error && (
        <div role="alert" className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
          <p className="font-medium">Error</p>
          <p className="text-sm">{error}</p>
        </div>
      )}
    </form>
  )
}

export default ShortenForm
