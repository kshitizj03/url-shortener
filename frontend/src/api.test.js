// Run with `npm test` (Node's built-in test runner, no extra dependencies).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { api } from './api.js'

const respond = (fn) => { globalThis.fetch = async (...args) => fn(...args) }

test('returns parsed JSON and sends token and JSON body', async () => {
  let seen
  respond((url, init) => { seen = { url, init }; return Response.json({ slug: 'abc1234' }, { status: 201 }) })
  assert.deepEqual(await api('/api/links', { method: 'POST', body: { url: 'https://example.com' }, token: 't0k' }), { slug: 'abc1234' })
  assert.equal(seen.url, '/api/links')
  assert.equal(seen.init.headers.Authorization, 'Bearer t0k')
  assert.equal(seen.init.headers['Content-Type'], 'application/json')
  assert.equal(seen.init.body, '{"url":"https://example.com"}')
})

test('uses the server error message and keeps the status', async () => {
  respond(() => Response.json({ error: 'That slug is already taken' }, { status: 409 }))
  await assert.rejects(api('/api/links'), (e) => e.message === 'That slug is already taken' && e.status === 409)
})

test('turns a non-JSON error page into a readable message', async () => {
  respond(() => new Response('<html>Error 1027</html>', { status: 503, headers: { 'Content-Type': 'text/html' } }))
  await assert.rejects(api('/api/links'), (e) => e.message === 'The server had a problem (503). Please try again.' && e.status === 503)
})

test('reports network failures instead of a raw TypeError', async () => {
  respond(() => { throw new TypeError('Failed to fetch') })
  await assert.rejects(api('/api/links'), /Could not reach the server/)
})

test('treats 204 as success with no body', async () => {
  respond(() => new Response(null, { status: 204 }))
  assert.equal(await api('/api/links/x', { method: 'DELETE' }), null)
})

test('rejects a 200 that is not JSON', async () => {
  respond(() => new Response('<html>ok</html>', { status: 200 }))
  await assert.rejects(api('/api/health'), /unexpected response/)
})
