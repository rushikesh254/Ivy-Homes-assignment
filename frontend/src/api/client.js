import axios from 'axios'

// The key can be overridden per deployment but defaults to the published one —
// the assignment requires the key in submission.json anyway.
export const REQUEST_KEY = import.meta.env.VITE_API_KEY || 'IVY26-7D1052B37658'
export const BASE_URL = import.meta.env.VITE_API_URL || 'https://solve.ivy.homes'

// Access tokens live 900 s (15 min), not the 86400 s the docs claim, so the app
// must refresh before the expiry, not just after a 401. Skew of 60 s keeps the
// rearm inside the slide window.
const REFRESH_SKEW_MS = 60_000
const ACCESS_KEY = 'session_access'
const REFRESH_KEY = 'session_refresh'
const ACCOUNT_KEY = 'session_account'

const client = axios.create({
  baseURL: BASE_URL,
  headers: { 'X-API-Key': REQUEST_KEY },
})

// ---- token plumbing ---------------------------------------------------------

// The service returns two-segment tokens (payload.signature), not three-segment
// JWTs — scan every segment for the one carrying the exp claim.
export function tokenClaims(token) {
  const parts = String(token || '').split('.')
  for (const p of parts) {
    try {
      const b64 = p.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(p.length / 4) * 4, '=')
      const json = JSON.parse(decodeURIComponent(escape(atob(b64))))
      if (json && typeof json === 'object' && typeof json.exp === 'number') return json
    } catch {
      // not this segment
    }
  }
  return null
}

function expiryOf(token) {
  const claims = tokenClaims(token)
  return claims?.exp ? claims.exp * 1000 : 0
}

export const stash = {
  token: () => localStorage.getItem(ACCESS_KEY),
  refresh: () => localStorage.getItem(REFRESH_KEY),
  account: () => {
    try { return JSON.parse(localStorage.getItem(ACCOUNT_KEY)) } catch { return null }
  },
  save(access, refresh, account) {
    localStorage.setItem(ACCESS_KEY, access)
    localStorage.setItem(REFRESH_KEY, refresh)
    localStorage.setItem(ACCOUNT_KEY, JSON.stringify(account))
  },
  clear() {
    localStorage.removeItem(ACCESS_KEY)
    localStorage.removeItem(REFRESH_KEY)
    localStorage.removeItem(ACCOUNT_KEY)
  },
}

// ---- proactive refresh -------------------------------------------------------

let rearmTimer = null

function scheduleRearm(access) {
  if (rearmTimer) clearTimeout(rearmTimer)
  const exp = access ? expiryOf(access) : 0
  if (!exp) return
  rearmTimer = setTimeout(() => { rotate().catch(() => {}) }, Math.max(0, exp - Date.now() - REFRESH_SKEW_MS))
}

export async function rotate() {
  const refresh = stash.refresh()
  if (!refresh) throw new Error('No session to rotate')
  const { data } = await axios.post(
    `${BASE_URL}/auth/refresh`,
    { refresh_token: refresh },
    { headers: { 'X-API-Key': REQUEST_KEY } }
  )
  commitSession(data)
  return data.access_token
}

function commitSession({ access_token, refresh_token, user }) {
  stash.save(access_token, refresh_token, user)
  client.defaults.headers.Authorization = `Bearer ${access_token}`
  scheduleRearm(access_token)
}

export function bootSession() {
  const access = stash.token()
  if (access) {
    client.defaults.headers.Authorization = `Bearer ${access}`
    scheduleRearm(access)
  }
}

// ---- request/response interceptors -------------------------------------------

client.interceptors.request.use((config) => {
  const access = stash.token()
  if (access) config.headers.Authorization = `Bearer ${access}`
  return config
})

let rotating = false
let queued = []

function flushQueue(reason, access = null) {
  for (const job of queued) {
    if (reason) job.reject(reason)
    else job.resolve(access)
  }
  queued = []
}

client.interceptors.response.use(
  (r) => r,
  async (err) => {
    const original = err.config
    if (err.response?.status === 401 && !original._retried) {
      if (!stash.refresh()) {
        endSession()
        return Promise.reject(err)
      }
      if (rotating) {
        return new Promise((resolve, reject) => {
          queued.push({ resolve, reject })
        }).then((access) => {
          original.headers.Authorization = `Bearer ${access}`
          return client(original)
        })
      }
      original._retried = true
      rotating = true
      try {
        const access = await rotate()
        flushQueue(null, access)
        original.headers.Authorization = `Bearer ${access}`
        return client(original)
      } catch (refreshErr) {
        flushQueue(refreshErr)
        endSession()
        return Promise.reject(refreshErr)
      } finally {
        rotating = false
      }
    }
    return Promise.reject(err)
  }
)

function endSession() {
  if (rearmTimer) clearTimeout(rearmTimer)
  stash.clear()
  delete client.defaults.headers.Authorization
}

// ---- auth endpoints ------------------------------------------------------------

export const authApi = {
  login: (email, password) =>
    axios.post(
      `${BASE_URL}/auth/login`,
      { email, password },
      { headers: { 'X-API-Key': REQUEST_KEY, 'Content-Type': 'application/json' } }
    ).then((r) => r.data),

  logout: async () => {
    try { await client.post('/auth/logout') } finally { endSession() }
  },

  apply(data) { commitSession(data) },
  reset() { endSession() },
}

// ---- listing / rental / project endpoints --------------------------------------
// Paged responses use { limit, offset, count, total, has_more, results } and the
// caller must follow has_more — total advertised by /health is unreliable.

export const listingApi = {
  page: (params) => client.get('/v1/listings', { params }).then((r) => r.data),
  one: (id) => client.get(`/v1/listings/${id}`).then((r) => r.data),
}

export const rentalApi = {
  page: (params) => client.get('/v1/rentals', { params }).then((r) => r.data),
  one: (id) => client.get(`/v1/rentals/${id}`).then((r) => r.data),
}

export const projectApi = {
  page: (params) => client.get('/v1/projects', { params }).then((r) => r.data),
  one: (id) => client.get(`/v1/projects/${id}`).then((r) => r.data),
}

// Walk every page of a collection until has_more flips off.
export async function crawl(fetch, limit = 50) {
  const rows = []
  let offset = 0
  for (;;) {
    const page = await fetch({ limit, offset })
    rows.push(...(page.results || []))
    if (!page.has_more) break
    offset += limit
  }
  return rows
}