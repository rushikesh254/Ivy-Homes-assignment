/**
 * Logged HTTP client for the Ivy Homes API.
 *
 * Rule for this whole project: nothing talks to the API except through here.
 * Every request and response is appended to logs/requests.ndjson so that any
 * claim we later put in submission.json can be traced back to the exact call
 * that proved it. A finding we cannot find in this log does not ship.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const LOG_FILE = path.join(ROOT, 'logs', 'requests.ndjson');

/** Minimal .env loader so scripts work without `--env-file` or a dependency. */
function loadEnv() {
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || line.trim().startsWith('#')) continue;
    if (process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["'](.*)["']$/, '$1');
    }
  }
}
loadEnv();

export const BASE_URL = process.env.IVY_BASE_URL ?? 'https://solve.ivy.homes';
export const API_KEY = process.env.IVY_API_KEY ?? '';
export const CITY = process.env.IVY_CITY ?? '';
export const LOCALITY = process.env.IVY_LOCALITY ?? '';
export const DEMO_EMAIL = process.env.IVY_DEMO_EMAIL ?? '';
export const DEMO_PASSWORD = process.env.IVY_DEMO_PASSWORD ?? '';

/** The fixed reference moment the assignment anchors every question to. */
export const REFERENCE_ISO = '2026-09-10T00:00:00+05:30';
export const REFERENCE_MS = Date.parse(REFERENCE_ISO);

let requestCount = 0;
export const stats = () => ({ requests: requestCount });

function redact(str) {
  let out = str;
  if (API_KEY) out = out.split(API_KEY).join('IVY26-<KEY>');
  if (DEMO_PASSWORD) out = out.split(DEMO_PASSWORD).join('<PASSWORD>');
  return out;
}

function appendLog(record) {
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
  fs.appendFileSync(LOG_FILE, JSON.stringify(record) + '\n', 'utf8');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Make one API call.
 *
 * @param {string} pathname            e.g. '/v1/listings'
 * @param {object} [opts]
 * @param {string} [opts.method]       default 'GET'
 * @param {object} [opts.query]        query params; undefined/null values are dropped
 * @param {string} [opts.token]        bearer token, if the call needs a user session
 * @param {any}    [opts.body]         JSON request body
 * @param {'header'|'query'|'none'} [opts.keyMode]
 *        How to present the API key. 'header' (default) sends X-API-Key, which
 *        is what the running service actually requires. 'query' reproduces what
 *        API_REFERENCE.md documents and is kept so the discrepancy stays
 *        reproducible. See notes/findings-log.md, finding AUTH-1.
 * @param {string} [opts.label]        human tag written to the log, e.g. 'recon:health'
 * @param {number} [opts.retries]      retries on 429 / network error (default 3)
 */
export async function api(pathname, opts = {}) {
  const {
    method = 'GET',
    query = {},
    token,
    body,
    keyMode = 'header',
    headers: extraHeaders = {},
    label = null,
    retries = 3,
  } = opts;

  const url = new URL(pathname, BASE_URL);
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }

  const headers = { accept: 'application/json' };
  if (API_KEY && keyMode === 'header') headers['X-API-Key'] = API_KEY;
  if (API_KEY && keyMode === 'query') url.searchParams.set('api_key', API_KEY);
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  Object.assign(headers, extraHeaders);

  for (let attempt = 0; ; attempt++) {
    const started = Date.now();
    let res = null;
    let text = null;
    let json = null;
    let netError = null;

    try {
      res = await fetch(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      text = await res.text();
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
    } catch (e) {
      netError = String(e && e.message ? e.message : e);
    }

    requestCount++;

    // Capture *all* response headers - undocumented ones are themselves a clue.
    const respHeaders = {};
    if (res) for (const [k, v] of res.headers.entries()) respHeaders[k] = v;

    appendLog({
      at: new Date().toISOString(),
      label,
      method,
      url: redact(url.toString()),
      key_mode: keyMode,
      auth: token ? 'bearer' : null,
      req_body: body === undefined ? null : JSON.parse(redact(JSON.stringify(body))),
      status: res ? res.status : null,
      ms: Date.now() - started,
      net_error: netError,
      res_headers: respHeaders,
      res_body: json !== null ? json : text === null ? null : text.slice(0, 4000),
    });

    const retryable = netError !== null || (res && (res.status === 429 || res.status >= 500));
    if (retryable && attempt < retries) {
      const waitMs = res && res.headers.get('retry-after')
        ? Number(res.headers.get('retry-after')) * 1000
        : 500 * 2 ** attempt;
      await sleep(Math.min(waitMs, 8000));
      continue;
    }

    return {
      status: res ? res.status : 0,
      ok: res ? res.ok : false,
      headers: respHeaders,
      text,
      json,
      url: redact(url.toString()),
      netError,
    };
  }
}

/** POST /auth/login -> whatever the server actually returns. */
export function login(email = DEMO_EMAIL, password = DEMO_PASSWORD, label = 'auth:login') {
  return api('/auth/login', { method: 'POST', body: { email, password }, label });
}

/**
 * Decode a token payload without verifying the signature, to read exp/iat.
 *
 * The service issues two-segment tokens (`payload.signature`), not the usual
 * three-segment JWT (`header.payload.signature`), so try every segment and keep
 * the first one that parses as JSON with an `exp`.
 */
export function decodeJwt(token) {
  const segments = String(token ?? '').split('.');
  for (const seg of segments) {
    try {
      const b64 = seg.replace(/-/g, '+').replace(/_/g, '/');
      const parsed = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
      if (parsed && typeof parsed === 'object' && 'exp' in parsed) return parsed;
    } catch {
      /* not this segment */
    }
  }
  return null;
}

export const j = (v) => JSON.stringify(v, null, 2);
export const keysOf = (v) => (v && typeof v === 'object' ? Object.keys(v) : []);
