# Findings log

Running lab notebook. Append-only; entries are edited only to change `status`.

Statuses:

- **CONFIRMED** — reproduced against the live API, with the proving request in
  `logs/requests.ndjson`. Only these are eligible for `submission.json`.
- **SUSPECTED** — a hypothesis I have formed but not yet proved. Never ships.
- **RULED OUT** — checked, and the documentation was right. These go in the
  README, because the hypotheses that did not pan out are part of the answer.

City for this key: **Pune** (`city_id: 3`). Assigned locality: **Magarpatta**.

---

## Session 1 — recon (21 requests, `scripts/00-recon.js`)

Dataset sizes reported by the API: listings `total: 3466`, rentals `total: 1323`,
projects `total: 401`.

### AUTH-1 · CONFIRMED · `*` · auth

The key must be sent as an `X-API-Key` request header. The documentation says to
append it as a query parameter (`GET /v1/listings?api_key=...`).

| request | result |
| --- | --- |
| no key at all | `401 {"detail":"missing X-API-Key header"}` |
| `?api_key=<valid>` | `401 {"detail":"send your key in the X-API-Key request header, not as a query parameter"}` |
| `X-API-Key: <invalid>` | `401 {"detail":"unknown api key"}` |
| `X-API-Key: <valid>` | passes the key check |

Found by making the first request exactly as documented and reading the error.
Kept as a permanent probe (`recon:key-in-query`) so it stays reproducible.

### AUTH-2 · CONFIRMED · `/auth/login` · auth

Every collection endpoint needs **both** the key and a bearer token. With a valid
key and no token: `401 {"detail":"missing bearer token - log in at POST /auth/login first"}`.
The documentation's own example (`GET /v1/listings?api_key=...`) shows the key
alone, and the listings/rentals/projects sections never mention a token.

### AUTH-3 · CONFIRMED · `/auth/login` · auth

The access token is in `access_token`. The documentation calls it `token`. A
client written to the documentation reads `undefined` and sends `Bearer undefined`.

Actual response keys: `access_token`, `refresh_token`, `token_type`,
`expires_in`, `refresh_url`, `user`.

### AUTH-4 · CONFIRMED · `/auth/login` · auth

`expires_in` is **900** seconds, not the documented 86400. Confirmed twice over:
the response field says 900, and the token's own `exp - iat` claim is 900.

```
access  claims: {"exp":1789298231,"iat":1789297331,"key":"IVY26-...","sub":"demo1@ivy.homes","typ":"access"}
refresh claims: {"exp":1789902131,"iat":1789297331,...,"typ":"refresh"}   -> 604800s = 7 days
```

This is what the problem statement is pointing at with "the app must still be
working thirty minutes after you logged in". A client that trusts the documented
24 hours is dead at minute 15.

### AUTH-5 · CONFIRMED · `/auth/login` · auth

The documentation states "There is no refresh flow." The login response carries a
`refresh_token` and `refresh_url: "/auth/refresh"`.

### AUTH-6 · CONFIRMED · `/auth/refresh` · undocumented_endpoint

`POST /auth/refresh` with `{"refresh_token": "..."}` returns a fresh token pair.
Absent from the documentation entirely.

Open question for a later session: the refresh call returned an access token
identical to the one it replaced. Probably because `iat` has one-second
granularity and both calls landed in the same second, making the payload — and
therefore the token — byte-identical. Re-test with a deliberate delay before
claiming anything about it.

### AUTH-7 · SUSPECTED · `/auth/login` · completeness

Documented `user` object is `{"email": ..., "name": ...}`; actual is `{"email": ...}`
only. Real but very minor. Decide later whether it is worth the precision risk.

### PAG-1 · CONFIRMED · `*` · pagination

Paging is `limit` + `offset`. **`page` is accepted and silently ignored.**

```
limit=1            -> DWE-3002501   (offset echoed 0)
limit=1&page=2     -> DWE-3002501   (offset echoed 0)  <- identical record
limit=1&offset=1   -> SQU-3001712   (offset echoed 1)
```

No 400, no warning. A client written to the documentation would fetch page 1 of
`total/limit` pages, get the same 20 records every time, and confidently report
having read the whole dataset. This is the single most destructive lie in the
document for anyone answering question 1.

### PAG-2 · CONFIRMED · `*` · pagination

Envelope is `{limit, offset, count, total, has_more, results}`. The documentation
says `{total, page, page_size, results}`. `page`/`page_size` do not exist;
`count` and `has_more` are undocumented. `has_more` is the reliable termination
signal, which is exactly what the statement means by "whether more remain".

### PAG-3 · CONFIRMED · `*` · pagination

Documented maximum `limit` is 200. The real ceiling is **50**, applied by silent
clamping rather than an error.

```
limit=200   -> 200 OK, echoed limit 50, 50 records
limit=201   -> 200 OK, echoed limit 50, 50 records
limit=500   -> 200 OK, echoed limit 50, 50 records
limit=99999 -> 200 OK, echoed limit 50, 50 records
limit=0     -> 422
limit=-1    -> 422
```

Because it clamps rather than errors, "divide `total` by your `limit` and request
that many pages" — the documented recipe — under-reads by 4x even if you had
paged correctly.

### MISS-1 · CONFIRMED · `/v1/analytics/summary` · missing_endpoint

`404 {"detail":"Not Found"}`. The documentation gives it a full response schema.
Everything the insights screen needs has to be computed client side.

### UNITS-1 · CONFIRMED (needs dataset-wide verification) · `/v1/projects` · units

Documentation: "`price_min` and `price_max` are in rupees." First project record:

```json
{ "project_id": "P30001", "price_min": 80, "price_max": 3.22, ... }
```

Neither is rupees. The values only make sense as **`price_min` in lakhs and
`price_max` in crores**: 80 lakh to 3.22 crore is an ordinary price band for a
Pune project. Note the trap — read as the same unit, `price_min > price_max` on
every record, which looks like corrupt data rather than a unit problem.

Question 7 asks for `price_max_inr` by name, which is consistent with this.

To verify across all 401 projects before this is safe to use:

1. `price_min_lakh * 1e5 <= price_max_crore * 1e7` should hold everywhere;
2. both should bracket the actual `price` values of listings carrying that
   `project_id`;
3. check whether the split is per-field (as it looks) or per-`website` / per-record.

### TIME-1 · CONFIRMED (interpretation still open) · `/v1/listings` · timestamps

Documentation: "Timestamps · ISO 8601, UTC, `Z` suffix, everywhere in the API."

- listing `posted_at`: `"2026-04-30T14:57:00"` — **no offset, no `Z`**
- rental `posted_at`: `"2026-09-04T00:21:00Z"` — has `Z`

So the claim is false, and the two endpoints disagree with each other. What is
still open is what the naive listing stamps actually mean. `/health` reports
`timezone: "Asia/Kolkata"` and a `+05:30` clock, which points at IST wall time,
but that is an inference, not a measurement. Question 8 depends on getting this
right, so it needs a real test: compare the hour-of-day distribution under each
interpretation, and check the maximum `posted_at` against the server clock.

### DATA-1 · SUSPECTED · `/v1/rentals` · consistency

First rental record: `title: "2 BHK for rent in Viman Nagar"` but
`locality: "kothrud"`, and the description also says Kothrud. Title disagrees
with the structured field. One record is an anecdote — needs a dataset-wide
count before it means anything.

### Confirmed fine so far

Things I checked in this session that the documentation got right, or that look
sound on first inspection:

- Error bodies really are `{"detail": "..."}` and really are useful. The 401 for
  a query-parameter key names the correct header. This is the most reliable part
  of the document.
- Default `limit` is 20, as documented.
- `/health` is unauthenticated and returns status plus the server clock, as
  documented, and additionally `timezone` and `reference_date`. The problem
  statement explicitly frames this one as not a discrepancy, so it is not
  reported.
- Listing money looks like plain rupees: ₹41,40,000 for a 493 sq ft 1 BHK in
  Wakad is ≈ ₹8,400/sq ft, which is right for Pune. Not yet checked across the
  whole dataset.
- Listing areas look like sq ft, with `carpet_area / super_built_up_area` = 0.756,
  a normal ratio. Also not yet checked dataset-wide.

### Undocumented fields spotted (to be reported once their behaviour is pinned down)

- `is_live` on listings and rentals — nowhere in the documentation, yet question 3
  is about it. The listings section claims inactive listings are excluded server
  side, so the field's presence already suggests otherwise.
- `count`, `has_more`, `offset` on every envelope.
- `title` on rentals is documented; `is_live` on rentals is not.

---

## Session 2 — full pull (121 requests) + offline profile (0 requests)

`scripts/01-pull.js` then `scripts/02-profile.js`. Snapshot in `data/raw/`.

Pulled with no filters, paging on `offset` until `has_more` is false:

| collection | `total` says | actually retrievable | gap |
| --- | --- | --- | --- |
| `/v1/listings` | 3466 | **3800** | +334 |
| `/v1/rentals` | 1323 | **1450** | +127 |
| `/v1/projects` | 401 | **440** | +39 |

### PAG-4 · CONFIRMED · `*` · pagination

`total` understates the number of retrievable records, in all three collections.
The documentation says: *"`total` is the exact number of records matching your
filters. To fetch every record, read `total`, divide by your `limit`, and request
that many pages."* Both sentences are wrong.

Ruled out as explanations:

- **not an `is_live` artefact** — 2998 listings are live, not 3466; and projects
  have no `is_live` field at all yet still show the same gap;
- **not a city leak** — every record in all three collections is `city_id: 3`;
- **not my pager** — the pager's own self-checks were clean, `offset` and `count`
  were echoed correctly on all 114 pages, no page repeated another, zero repeated
  ids, and re-fetching offset 0 and the midpoint after the crawl returned
  identical records, so the ordering is stable and offset paging is sound here.

The only reliable terminator is `has_more`. Worth noting which fields
`statement.md` vouches for: *"which limit and offset it used, how many records it
returned, and whether more remain"* — that is `limit`, `offset`, `count` and
`has_more`. `total` is conspicuously absent from that list.

### COMP-1 · CONFIRMED · `/v1/listings` · completeness

The documentation: *"Returns **active** sale listings in your city. Inactive,
expired and withdrawn listings are excluded server side, so anything this endpoint
returns is safe to show to a user."*

**802 of 3800 records have `is_live: false`.** Nothing is excluded. A frontend
built on that sentence shows withdrawn listings to users as though they were live.

### UNDOC-2 · CONFIRMED · `/v1/listings` · undocumented_endpoint/completeness

`is_live` is absent from the documented listing object and from the documented
rental object, yet it exists on both (rentals: 204 of 1450 are false) and
question 3 is about it.

### UNITS-1 · CONFIRMED, now verified dataset-wide · `/v1/projects` · units

`price_min` is in **lakhs**, `price_max` is in **crores**. Documentation says both
are rupees.

Evidence, across all 440 projects:

- read as the same unit, **321 of 440** records have `price_min > price_max`;
- read as lakhs and crores respectively, **0 of 440** violate `min <= max`;
- converted medians land at ₹64.15 lakh and ₹2.04 crore, an ordinary Pune band;
- `min_area_sqft > max_area_sqft` never happens, so the ordering convention itself
  is not broken — only the units are.

Zero violations out of 440 under the proposed reading, versus 321 under the
documented one, is what turns this from a guess into a measurement.

### DQ · CONFIRMED · `/v1/listings` · data_quality — question 4 candidates

Each rule counted separately so the residuals stay visible:

| rule | hits |
| --- | --- |
| `latitude`/`longitude` transposed (lat > 70, lng < 20) | **7** |
| `price` negative | **7** |
| `floor > total_floors` | **7** |
| `posted_at` after REFERENCE | **7** |
| `carpet_area > super_built_up_area` (strictly greater) | **5** |

Seven, four times over, plus five. That regularity suggests deliberately planted
sets rather than noise.

### The residual that mattered — plots are not corrupt

My first pass flagged **143** records for `carpet_area >= super_built_up_area`,
and the same 143 for `bedroom <= 0` and `bathroom <= 0`, and 136 for
`total_floors <= 0`. Reporting 143 corrupt records would have been wrong.

Looking at what the rule got wrong: those records are `property_type: "plot"`.
A plot legitimately has no bedrooms, no bathrooms, no floors, and a carpet area
equal to its built-up area, because it is land. The rule fit "most of the data"
and its misfits were the whole story.

So the impossibility rule has to be `carpet_area > super_built_up_area`
**strictly**, which leaves 5 records, and the bedroom/bathroom/floor rules have to
be conditioned on property type. This is the single clearest instance in this
dataset of what `statement.md` warns about: *"the first rule that fits will
usually fit most of the data. Look hard at what it gets wrong."*

### UNITS-2 · SUSPECTED · `/v1/listings` · units

Price per carpet sq ft, by source website:

| website | n | p1 | p50 | p99 | max |
| --- | --- | --- | --- | --- | --- |
| dwelling | 771 | 3,827 | 10,376 | 15,347 | 15,976 |
| squarelane | 744 | 3,924 | 10,308 | 15,370 | 15,751 |
| 100acres | 743 | 4,289 | 10,320 | 15,270 | 15,885 |
| zerobroker | 782 | 4,138 | 10,350 | 15,147 | 16,228 |
| **magichomes** | **760** | **4,337** | **13,294** | **162,444** | **168,469** |

Four of the five feeds are clean and tightly bounded. `magichomes` alone has a
tail two orders of magnitude out, and 162,444 / 10,350 ≈ 15.7 — while
168,469 / 15,976 ≈ 10.5, close to the 10.764 sq ft per sq m conversion.

Corroborating: the smallest carpet areas in the dataset are 41, 49, 133, 140,
141, 144 — and every one I have looked at so far carries a `MAG-` id. `MAG-3001695`
is a 1 BHK with `carpet_area: 49`, `super_built_up_area: 64`. As square metres
that is 527 / 689 sq ft, and ₹38.7 lakh / 527 sq ft = ₹7,343 per sq ft, which is
normal. As square feet it is a 49 sq ft one-bedroom flat.

**Why the ratio test did not catch these:** `carpet/super` is unit-invariant, so
when *both* fields are converted the ratio stays at 0.766 and looks perfectly
healthy. The ratio test finds single-field errors; whole-record conversions need
a different probe. Next session: find the exact discriminator, and establish
whether it is all of `magichomes` or a subset.

### TIME-1 · still open, narrowed · `/v1/listings` · timestamps

Hour-of-day is uniform in both collections (coefficient of variation 0.072 and
0.111), so the "humans post in daylight" test has no power here — that hypothesis
is dead. What does have power:

| reading | max `posted_at` | records >= REFERENCE | Q8 count |
| --- | --- | --- | --- |
| naive as IST | 2027-05-03T03:54Z | 7 | **128** |
| naive as UTC | 2027-05-03T09:24Z | 25 | **115** |
| rentals (explicit `Z`) | 2026-09-09T17:03Z | 0 | — |

Every rental stops before REFERENCE, which suggests the dataset was generated up
to REFERENCE and nothing legitimate should sit beyond it. Under IST only 7
listings breach it, one of them dated 2027 — consistent with a small planted set.
Under UTC, 25 breach it. Not yet decisive: needs the boundary examined record by
record, because 18 records landing in one 5.5-hour stretch is more than a uniform
distribution predicts.

### CONS-1 · SUSPECTED · `/v1/rentals` · consistency

`title` has only 40 distinct values across 1450 rentals — the shape is
`"{bedroom} BHK for rent in {Locality}"`, 10 localities x 4 bedroom counts. And
**132 rentals mention Magarpatta in their title or description while their
`locality` field says something else**, versus 130 whose `locality` is
`magarpatta`. `description` agrees with `locality`; `title` does not. Needs a
systematic match rate before it is reportable, and it matters directly for
question 5.

### Question 10 groundwork

`total_listings` vs the actual number of listing records carrying that
`project_id`:

- reported != count of **all** matching listings: **317 of 440**
- reported != count of **live** matching listings: **95 of 440**

The documentation defines it as *"the number of listings currently available"*,
which argues for the live reading, but also claims it *"always agrees with what
`GET /v1/listings?project_id=...` returns"*, which argues for the all reading
since that endpoint returns non-live records too. Some projects report **more**
than even the all count (P30003 reports 7, has 4), so neither reading rescues
every row. Needs deciding on evidence, not on preference.

No orphans: every `project_id` referenced by a listing exists in `/v1/projects`.
1461 of 3800 listings have a null `project_id`, which the documentation does
describe correctly.

### Question 9 groundwork — the contact-number structure

3800 listings share only **642** distinct `posted_by_contact` values. Two clearly
different populations at the top:

| contact | listings | distinct names | roles |
| --- | --- | --- | --- |
| +912002574181 | 31 | 5 | agent |
| +912009819040 | 30 | 3 | agent |
| +912006085798 | 30 | 5 | agent |
| ... | | | |
| +912007826250 | 16 | **1** | **agent / owner / builder** |
| +912004418955 | 14 | **1** | **owner / builder / agent** |
| +912008812189 | 13 | **1** | **agent / owner / builder** |

The first group is a shared agency line: many staff names, one number, always
role `agent`. Ordinary.

The second group is one number, one *person's* name, listed simultaneously as the
**owner**, the **builder** and the **agent** of properties across seven to nine
different localities. A single individual cannot be the owner of scattered
properties in nine localities and also their builder. That is a much better fraud
signal than listing volume alone, and it is the lead to develop next.

### Ruled out this session

- **Records leaking from another city.** Every record in all three collections is
  `city_id: 3`. The documented city scoping holds.
- **Repeated ids across pages.** All 3800 / 1450 / 440 ids are distinct. The
  documented uniqueness of `listing_id` is true in this snapshot; question 2 is
  therefore about records that describe the same property, not about repeated ids.
- **Unstable pagination ordering.** Re-fetching offset 0 and the midpoint after
  the crawl returned byte-identical records, so offset paging cannot have skipped
  or repeated anything.
- **Locality strings not lowercase.** All 10 locality values in all three
  collections are lowercase, as documented. Same for `furnishing`,
  `property_type`, `project_status`.
- **Rental prices in the wrong unit.** Monthly rent per carpet sq ft runs 22 to 60
  with p99 at 59.5 and max 60.0 — a tight band with no 12x tail, so no annual
  figures are mixed in. `deposit/price` runs 2 to 10 months. Rental money looks
  exactly as documented.
- **Rental areas in the wrong unit.** `carpet/super_builtup` ranges 0.690 to 0.801
  across all 1450 records with zero outliers. Cleaner than the listings.
- **Hour-of-day as a timezone tell.** Posting times are uniform across the clock
  in both collections, so this cannot discriminate IST from UTC. Dead end, and
  worth recording as one.
- **Coordinates as a duplicate key.** 247 coordinates carry more than one record,
  but inspection shows they are different flats in the same building — a 1 BHK on
  floor 21 and a 4 BHK on floor 14 of the same tower share coordinates because
  coordinates are building-level. Using lat/lng as a dedup key would have merged
  genuinely distinct properties. Rejected.
- **Projects with impossible dates or counts.** No project has
  `possession_date < launch_date`, `total_units <= 0`, `total_towers <= 0`, or
  `min_area_sqft > max_area_sqft`.

---

## Session 3 — units and timestamps settled (0 requests, all offline)

`scripts/03-units.js`, `scripts/lib/normalize.js`, `scripts/04-time.js`.

### UNITS-2 · CONFIRMED · `/v1/listings` · units

**306 of 3800 listings serve `carpet_area` and `super_built_up_area` in square
metres**, not the documented square feet.

Detection used no absolute threshold, because a threshold cannot separate "wrong
unit" from "genuinely small home". Each record was scored against the median
carpet area of records sharing its `property_type` and `bedroom` count:

```
score = carpet_area / median carpet_area for the same type and bedroom count
```

The result is sharply bimodal, and the gap is the proof:

| score band | records |
| --- | --- |
| below 0.06 | 0 |
| 0.06 – 0.08 | 4 |
| **0.08 – 0.11** | **295** |
| 0.11 – 0.14 | 6 |
| 0.14 – 0.30 | 1 |
| 0.30 – 0.50 | 4 |
| 0.70 – 1.50 | 3458 |

Median score of the low mode: **0.0933**. Predicted for square metres:
1/10.7639 = **0.0929**.

Three independent corroborations:

1. **Convert and re-measure.** Multiply the 306 by 10.7639 and their price per
   sq ft goes from p5/p50/p95 of 61,944 / 111,008 / 156,961 to
   **5,755 / 10,313 / 14,582**, against the clean feeds' **5,974 / 10,338 /
   14,538**. The distributions land on top of each other.
2. **Same building, both units.** In *Rohan Grand*, magichomes lists a 2 BHK at
   `carpet_area: 73` while three other feeds list 921, 776 and 786 for the same
   building. 73 x 10.7639 = 785.8. Same pattern in *Kolte Patil Habitat*
   (122 -> 1313 against 1253, 1215, 1120), *Puravankara Willows*,
   *Shriram Greens*, *Mantri Willows*.
3. **Feed isolation.** The other four feeds have **zero** records above 20,000
   per sq ft; magichomes has 303. But only 306 of magichomes' 760 records are
   affected, so the rule is a property of the record, not of the website.

**Why the ratio test could not find this.** `carpet_area / super_built_up_area`
is unit-invariant. Both area fields are converted together, so the ratio stays at
a perfectly healthy 0.746 (against 0.742 for the clean feeds) on exactly the
records that are wrong. A submission that only ran the ratio test — which is the
obvious first test, and the one I ran first — misses all 306.

### UNITS-1 · CONFIRMED and refined · `/v1/projects` · units

Not "price_min is lakhs and price_max is crores". The unit depends on the
**value**, not the field: **below ₹1 crore the number is in lakhs, at or above
₹1 crore it is in crores.** Both fields, one rule. These are Indian display
units leaking into an API that documents plain rupees.

The proof is an empty quadrant. Splitting all 440 projects at a served value of 10:

| | `price_max` < 10 | `price_max` >= 10 |
| --- | --- | --- |
| `price_min` < 10 | 97 (both crores) | **0** |
| `price_min` >= 10 | 321 (lakh, then crore) | 22 (both lakhs) |

The empty cell is the impossible one: a minimum of at least ₹1 crore combined
with a maximum below ₹1 crore. Under a per-field rule the unit assignment would
be independent of value and roughly 24 projects would land there. Zero do.

Supporting: the served values themselves are bimodal with empty gaps —
`price_min` occupies [1, 1.53] ∪ [30, 99.9] and `price_max` occupies
[1.01, 4.47] ∪ [62.7, 99.9]. The threshold of 10 sits inside both gaps, so the
decision is never close.

Cross-check against area: dividing the decoded price by `max_area_sqft` puts
every project between roughly ₹5,300 and ₹11,000 per sq ft against a listing
median of ₹10,334. The rejected reading puts 22 projects between ₹530,000 and
₹870,000 per sq ft.

Decoded, `price_min_inr > price_max_inr` never happens. As served, it happens on
321 of 440.

**Consequence for question 7.** Taking `price_max` at face value, or treating all
of it as crores, gives P30394 at ₹99.9 crore. Decoded, P30394's maximum is
₹99.9 **lakh** and the costliest project is **P30288 at ₹4,47,00,000**
(₹12,764 per sq ft on its 3502 sq ft top unit — plausible). The 22 records the
simple rule gets wrong are exactly the ones that dominate the answer.

### TIME-1 · CONFIRMED · `/v1/listings` and `/v1/rentals` · timestamps

The documentation claims ISO 8601 UTC with a `Z` suffix everywhere. Listing
`posted_at` carries **no offset at all** (3800 of 3800); rental `posted_at`
carries **`Z`** (1450 of 1450). Two endpoints, two conventions, neither as
documented.

**The naive listing stamps are IST wall-clock.** Evidence:

1. **They stop at naive midnight.** The largest legitimate value is
   `2026-09-09T23:54:00`, six minutes before midnight, and then there is nothing
   for thirty days until `2026-10-09T13:34:00`. REFERENCE is
   `2026-09-10T00:00:00+05:30`. The data stops exactly at REFERENCE read as IST.
2. **Only the IST reading gives both collections the same cap.** Rentals carry
   explicit `Z` and stop at `2026-09-09T17:03:00Z`, 1.45 hours short of
   REFERENCE against an extreme-value prediction of 1.98 hours — a clean fit.
   Read the naive listing stamps as UTC and the listings run **5.4 hours past**
   the cap the rentals respect. Read them as IST and the gap is 0.10 hours, on
   the same side of REFERENCE. Same generator, same cap, one consistent reading.
3. Under the UTC reading, 18 records pile into the 5.5 hours immediately after
   REFERENCE. Under IST they sit in the final hours before it.
4. `/health` reports `timezone: "Asia/Kolkata"` and `reference_date` with an
   explicit `+05:30`.

**Question 8 = 128** under the IST reading, against 115 under UTC. The 23 records
the two readings disagree about are listed in `notes/04-time.json`.

### DQ-5 · CONFIRMED · `/v1/listings` · data_quality

Seven listings are dated after REFERENCE, from 29 to 235 days past it:
`DWE-3000830`, `DWE-3000032`, `100-3000532`, `100-3002582`, `100-3000685`,
`SQU-3001957`, `SQU-3003016`. The 30-day hole between the last legitimate record
and the first of these confirms they are planted rather than a boundary artefact.

### Ruled out this session

- **`price_min` is lakhs, `price_max` is crores (per-field units).** Fits 418 of
  440 and is the obvious reading. Wrong: it is a per-value rule. Kept because the
  22 records it misclassifies are exactly the ones question 7 turns on.
- **The whole `magichomes` feed is in square metres.** Only 306 of its 760
  records are. The website correlates perfectly but does not define the rule.
- **`carpet/super` ratio as a unit test.** Unit-invariant, so blind to the
  306-record square-metre problem. Genuinely useful for the 5 records where
  carpet strictly exceeds super built-up, and useless for this.
- **Hour-of-day clustering as a timezone test.** Uniform in both collections;
  no discriminating power.
- **Rental `Z` stamps secretly being IST.** Tested: relabelling them as IST puts
  the extreme value 6.95 hours from REFERENCE against a 1.99-hour prediction
  (ratio 3.49), versus 1.45 hours at face value (ratio 0.73). The `Z` is honest.
- **Project date fields.** `launch_date` and `possession_date` are plain
  `YYYY-MM-DD` as documented, no project launches after REFERENCE, and none has
  possession before launch.
- **Project areas.** `min_area_sqft` 607–1397 and `max_area_sqft` 944–3545, with
  `min > max` never occurring. These are genuinely square feet.
