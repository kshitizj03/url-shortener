import { useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'

function ResultCard({ result, onReset }) {
  const [copied, setCopied] = useState(false)

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(result.shortUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }

  return (
    <div className="space-y-6">
      {/* Success Message */}
      <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
        <p className="text-green-700 font-medium">URL shortened successfully!</p>
      </div>

      {/* Short URL Display */}
      <div className="flex items-center gap-3">
        <div className="flex-1 p-4 bg-gray-50 rounded-lg border border-gray-200">
          <p className="text-sm text-gray-500 mb-1">Your short URL</p>
          <a 
            href={result.shortUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xl font-mono text-blue-600 hover:underline break-all"
          >
            {result.shortUrl}
          </a>
        </div>
        <button
          onClick={copyToClipboard}
          className={`px-4 py-3 rounded-lg font-medium transition-colors ${
            copied 
              ? 'bg-green-500 text-white' 
              : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
          }`}
        >
          {copied ? (
            <span className="flex items-center gap-1">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              Copied!
            </span>
          ) : (
            <span className="flex items-center gap-1">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} 
                      d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              Copy
            </span>
          )}
        </button>
      </div>

      {/* QR Code */}
      <div className="flex flex-col items-center p-6 bg-white border border-gray-200 rounded-lg">
        <p className="text-sm text-gray-500 mb-4">Scan QR Code</p>
        <QRCodeSVG 
          value={result.shortUrl} 
          size={180}
          level="M"
          marginSize={2}
        />
      </div>

      {/* URL Details */}
      <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
        <h3 className="font-medium text-gray-700 mb-2">Details</h3>
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <dt className="text-gray-500">Slug:</dt>
          <dd className="font-mono">{result.slug}</dd>

          <dt className="text-gray-500">Original URL:</dt>
          <dd className="truncate" title={result.url}>{result.url}</dd>

          <dt className="text-gray-500">Created:</dt>
          <dd>{new Date(result.createdAt).toLocaleString()}</dd>
          
          {result.expiresAt && (
            <>
              <dt className="text-gray-500">Expires:</dt>
              <dd>{new Date(result.expiresAt).toLocaleString()}</dd>
            </>
          )}
        </dl>
        <p className="mt-3 text-xs text-gray-500">
          This browser keeps the link's private manage token, so you can see its stats under My Links.
          Clearing site data loses it.
        </p>
      </div>

      {/* Actions */}
      <div className="flex gap-3">
        <button
          onClick={onReset}
          className="flex-1 px-4 py-3 bg-blue-600 text-white font-medium rounded-lg
                     hover:bg-blue-700 transition-colors"
        >
          Shorten Another URL
        </button>
      </div>
    </div>
  )
}

export default ResultCard
