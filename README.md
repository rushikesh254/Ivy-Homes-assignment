# Ivy Homes — Software Engineering Internship (Pune)

Three parts of one investigation: **a working frontend** built on a documentation-that-lies API, **ten verified answers**, and **a findings list** of everywhere the docs disagree with the service. All arithmetic is reproducible from the snapshot in `data/raw/`; nothing is typed in by hand.

**City:** Pune (`city_id: 3`) · **Assigned locality:** Magarpatta · **Reference moment:** `2026-09-10T00:00:00+05:30`

---

## The frontend — `frontend/`

React 19 + Vite + Tailwind v4 + TanStack Query v5 + React Router v7 + axios + lucide. A deliberately dark "Property Intelligence" theme (DM Sans/DM Mono, amber accent, violet reserved for projects, red flags for anything suspicious). Original code throughout — built from scratch to match the brief's look, not copied from it.

### The six things that must work

1. **Login** — real `/auth/login` with demo creds; session survives refresh (localStorage + persisted token), and a pre-emptive `/auth/refresh` at expiry−60s means the app still works far past 30 minutes. Token expiry was discovered to be **900s, not the documented 86400s**.
2. **Browse listings** — server-paginated grid (offset/limit, follows `has_more`); filters for locality, BHK, and furnishing hit the API, and price range filters locally (the reference filter applies but silently ignores nothing).
3. **Listing detail** — every tile links to `/listings/:id`, reachable by URL. Shows decoded price, corrected area, the finding badges that apply, the shared-contact warning, and a Google Maps link (geo coordinates exist on all 3800/1450/440 records).
4. **Saved listings** — add/remove/list per account in localStorage (`saved_<account>`), survives reload and re-login.
5. **Rentals & projects** — browsable with **correct prices and areas**: project prices decoded per the lakhs-below-₹1Cr / crores-above rule, 306 sqm listings converted to sq.ft at 10.7639, rental `posted_at` read as the real UTC it actually is. Detail pages at `/rentals/:id` and `/projects/:id`.
6. **Insights** — `/v1/analytics/summary` is a documented 404, so the screen computes the same aggregates client-side from a full crawl: advertised vs actual totals, median price / ₹/sq.ft, locality and BHK distributions, new-in-last-7-days, and every discovery from Part 3 rendered where a user can see it.

```bash
cd frontend
npm install
npm run dev        # local dev server
npm run build      # production build (dist/)
```

Demo logins: `demo1@ivy.homes` / `demo2@ivy.homes` / `demo3@ivy.homes`, password `86ad2ae6e0`.

`frontend/src/data/findings.js` (fake/duplicate/corrupt id sets, advertised vs snapshot totals, reference date) is generated — run `npm run corrections` after any analysis change.

---

## The ten answers

| # | Answer | |
| --- | --- | --- |
| 1 | `total_listing_records` | **3800** — endpoint advertises `total: 3466` |
| 2 | `unique_properties` | **3230** — 570 records are re-listings |
| 3 | `active_listings` | **2998** — 802 not live, which docs say "cannot happen" |
| 4 | `corrupt_listing_ids` | **42** — six contradictions, exactly seven records each |
| 5 | `total_monthly_rent` | **₹48,55,700** across 130 Magarpatta rentals |
| 6 | `avg_price_per_sqft_2bhk` | **10844.99** (19042.07 without the sqm correction) |
| 7 | `costliest_project` | **P30288**, ₹4,47,00,000 — not the apparent ₹99.9 Cr |
| 8 | `listings_last_7_days` | **128** (115 if timestamps were wrongly read as UTC) |
| 9 | `fake_listing_ids` | **320** across 12 phone numbers |
| 10 | `projects_with_wrong_listing_count` | **95** of 440 |

`npm run verify` re-derives every answer from the snapshot and exits non-zero on any mismatch, so `submission.json` cannot drift from the arithmetic.

## The findings (36)

`submission.json` holds the full list with evidence ids. The headline lies: the auth token lives 15 minutes not 24h; the API key is a header (`X-API-Key`), not `?api_key=`; pagination is offset-based, not `page=`; the single-listing path is `/v1/listings/{id}`, not `/v1/listing/{id}`; `/v1/analytics/summary` 404s; rental `posted_at` is real UTC while listing `posted_at` is naive IST; project prices switch unit by value (lakhs vs crores); 306 records carry sqm areas labelled sq.ft; 570 duplicates, 42 impossible records, and 320 fake listings hide behind 12 shared phone numbers. `notes/findings-log.md` is the notebook, including the hypotheses that failed.

---

## Running the analysis

Node 20.6+, zero runtime dependencies.

```bash
cp .env.example .env      # IVY_API_KEY + demo password
npm run pull              # probe first (21 requests), then the full ~150-request crawl
npm run analyse           # profile → units → time → dupes → fraud → corrupt → answers → submission → verify
npm run verify            # re-derive all ten answers; fail on any mismatch
```

## How I decided what to distrust

The brief warns the docs may be wrong, so every sentence was a claim to test, not a description to read. Three rules shaped it:

- **Probe before downloading.** Auth, paging and field names fail *silently* if guessed wrong, so they went first. The reference's literal first request 401s — with the correct header named in the error body, which turned out to be the single most reliable part of the document. Every request is logged to `logs/requests.ndjson`; a finding you cannot point at a logged response for does not ship.
- **Form the hypothesis before you look.** A wrong pagination model doesn't error, it hands you a confidently wrong answer to Q1. The real lies are in *distributions*, not any single response.
- **The first rule that fits will fit most of the data — look hard at what it gets wrong.** Happened three times: the impossible-record rule flagged 143 records that were really 136 plots plus 7 genuinely corrupt apartments; "price_min = lakhs, price_max = crores" fit 418/440 projects until the empty quadrant (zero crore-min/lakh-max records) proved the unit follows the *value*; and the fraud rule described 557/642 contacts before I checked the wrong direction — the tell is many *names* on one number, covering just 12 contacts.

## What I checked that turned out to be fine

Error bodies are genuinely useful; every documented listing filter works; default `limit` is 20; city scoping holds (all 5,690 records `city_id: 3`); ids are unique and `project_id` ∅ on resale with no orphans; rental money/areas are clean (no twelve-times tail, deposit ratios 2–10 months) — "correct prices and areas" for rentals and projects points at *projects*; project areas and launch/possession dates are well-formed; **rentals and projects contain zero corrupt records, rentals contain zero duplicates**; offset paging is stable (re-fetch returned byte-identical records); `/health` is exactly what it says it is.

Reasonable hypotheses that were wrong: hour-of-day can't reveal the timezone (posting is uniform, CV 0.07/0.11); coordinates identify a *building*, not a property ((lat,lng,bedroom,floor) collides zero times); `total` isn't any real count but `round(true × 0.91215)` — a scaling bug, identical across endpoints; seller descriptions agree with the structured fields (it's the *rental titles* that lie, all 1450); high listing volume isn't fraud (that's an agency line); `/auth/logout` returns `{"ok": true}` and the token keeps working — so *that* one is a finding; the 306 sqm records aren't the whole `magichomes` feed — detection is per-record.

## What I would do with another two days

1. Attack Q2 harder — a real pairwise scorer over all 3800 records instead of blocking on ten exact fields.
2. Explain the 0.91215 constant (page a tiny filter and watch `total` round).
3. Chase the ~13-listing cluster in the last three hours before the reference moment (question-8 boundary).
4. Trigger the documented 403 and 429 paths to confirm or rule them out.
5. Cross-check `is_verified` (true on 85% of the fake set vs 62% overall) — suggestive, but correlation inside a set I selected on other grounds.

---

## Layout

```
frontend/             the React app (see section above)
scripts/              00-recon → 01-pull → 02-profile → 03-units → 04-time
                      → 05-dupes → 06-fraud → 07-corrupt → 08/09/10-probe
                      → 11-answers → 12-frontend-data → 13-verify → 14-submission
  lib/http.js         the only thing that touches the network; logs every call
  lib/normalize.js    the single correction layer - units, prices, timestamps
notes/                findings-log.md - the notebook, and script transcripts
data/raw/             the snapshot every number is reproducible from
submission.json       the ten answers + 36 findings, generated, never hand-typed
```

`logs/` and `.env` are gitignored.

## Tools

I used Claude (via Kiro) for scripting, prose, and a second pair of eyes. It did the mechanical work — sweeping endpoints, diffing against the reference — and never produced the hypotheses: scoring areas against a per-bedroom median, reading the empty quadrant as proof of the price rule, and noticing only the IST reading sits both collections under one cap. It also wrote a confident-but-wrong fraud rule straight into a file after the data had disproved it; that is why `npm run verify` exists.