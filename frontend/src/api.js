// The one way the app calls the Worker. It always resolves to parsed JSON or throws an Error
// with a message fit to show the user, including when the network is down or the response is
// not JSON (Cloudflare's own error pages, such as the free-plan limit page, are HTML).

// Same origin in production (the Worker serves this app); Vite proxies /api in dev.
const API_URL = import.meta.env?.VITE_API_URL || '' // env is undefined outside Vite (tests)

export async function api(path, { token, body, ...init } = {}) {
  const headers = { ...init.headers }
  if (token) headers.Authorization = `Bearer ${token}`
  if (body !== undefined) headers['Content-Type'] = 'application/json'

  let res
  try {
    res = await fetch(API_URL + path, { ...init, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  } catch {
    throw new Error('Could not reach the server. Check your connection and try again.')
  }
  if (res.status === 204) return null

  const data = await res.json().catch(() => null)
  if (!res.ok) {
    const err = new Error(data?.error || `The server had a problem (${res.status}). Please try again.`)
    err.status = res.status
    throw err
  }
  if (data === null) throw new Error('The server sent an unexpected response. Please try again.')
  return data
}
