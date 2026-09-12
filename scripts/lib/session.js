/**
 * User session with automatic refresh.
 *
 * Why this exists: POST /auth/login returns `expires_in: 900`, i.e. the access
 * token dies after 15 minutes. API_REFERENCE.md claims 86400 seconds and states
 * "There is no refresh flow." Both are wrong - the login response carries a
 * `refresh_token` and a `refresh_url` of /auth/refresh.
 *
 * That matters for two reasons:
 *   - a full dataset crawl can easily run past 15 minutes, so the crawler has to
 *     refresh itself or it dies half way through with a 401;
 *   - anyway, an authenticated session has to outlive the token it started with.
 */

import { api, decodeJwt, DEMO_EMAIL, DEMO_PASSWORD } from './http.js';

/** Refresh this many seconds before the token actually expires. */
const REFRESH_SKEW_S = 60;

export class Session {
  constructor({ email = DEMO_EMAIL, password = DEMO_PASSWORD, verbose = false } = {}) {
    this.email = email;
    this.password = password;
    this.verbose = verbose;
    this.accessToken = null;
    this.refreshToken = null;
    this.expiresAtMs = 0;
    this.loginBody = null;
    this.refreshCount = 0;
  }

  log(...args) {
    if (this.verbose) console.log('[session]', ...args);
  }

  #adopt(body) {
    this.loginBody = body;
    this.accessToken = body.access_token ?? body.token ?? null;
    if (body.refresh_token) this.refreshToken = body.refresh_token;

    // Prefer the token's own exp claim over expires_in; trust the artefact,
    // not the description of the artefact.
    const claims = decodeJwt(this.accessToken);
    if (claims?.exp) {
      this.expiresAtMs = claims.exp * 1000;
    } else if (body.expires_in) {
      this.expiresAtMs = Date.now() + Number(body.expires_in) * 1000;
    } else {
      this.expiresAtMs = Date.now() + 300_000;
    }
    this.log(`token good for ${((this.expiresAtMs - Date.now()) / 1000).toFixed(0)}s`);
  }

  async login() {
    const res = await api('/auth/login', {
      method: 'POST',
      body: { email: this.email, password: this.password },
      label: 'session:login',
    });
    if (!res.ok || !res.json) {
      throw new Error(`login failed: ${res.status} ${res.text?.slice(0, 200)}`);
    }
    this.#adopt(res.json);
    return res.json;
  }

  /** Try the undocumented /auth/refresh. Falls back to a fresh login. */
  async refresh() {
    if (!this.refreshToken) return this.login();
    const url = this.loginBody?.refresh_url ?? '/auth/refresh';
    const res = await api(url, {
      method: 'POST',
      body: { refresh_token: this.refreshToken },
      label: 'session:refresh',
    });
    if (res.ok && res.json && (res.json.access_token || res.json.token)) {
      this.refreshCount++;
      this.#adopt(res.json);
      return res.json;
    }
    this.log(`refresh failed (${res.status}), falling back to login`);
    return this.login();
  }

  get expiresInS() {
    return Math.round((this.expiresAtMs - Date.now()) / 1000);
  }

  /** Ensure a usable access token, refreshing pre-emptively near expiry. */
  async token() {
    if (!this.accessToken) await this.login();
    else if (Date.now() > this.expiresAtMs - REFRESH_SKEW_S * 1000) await this.refresh();
    return this.accessToken;
  }

  /**
   * Authenticated request. Retries once on a 401 in case the token lapsed
   * between our expiry estimate and the server's opinion of it.
   */
  async get(pathname, opts = {}) {
    const token = await this.token();
    let res = await api(pathname, { ...opts, token });
    if (res.status === 401) {
      this.log('401 - re-authenticating and retrying once');
      await this.refresh();
      res = await api(pathname, { ...opts, token: this.accessToken });
    }
    return res;
  }

  post(pathname, body, opts = {}) {
    return this.get(pathname, { ...opts, method: 'POST', body });
  }

  del(pathname, opts = {}) {
    return this.get(pathname, { ...opts, method: 'DELETE' });
  }
}
