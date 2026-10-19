// Links created in this browser, with their manage tokens. Until accounts exist, this is
// how a creator gets back to their stats. Storage can be unavailable (private mode), so
// every access is guarded and the app still works without it.
const KEY = 'myLinks'

export function loadLinks() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) ?? []
  } catch {
    return []
  }
}

export function saveLinks(links) {
  try {
    localStorage.setItem(KEY, JSON.stringify(links))
  } catch {
    // ignore: the token is still shown once in the result card
  }
}
