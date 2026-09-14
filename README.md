# Ivy Homes assignment — Pune

A record of everywhere the Ivy Homes API reference disagrees with the running
service.

`submission.json` at the root holds the ten answers and 36 findings.
`notes/findings-log.md` is the lab notebook the findings came out of, including the
hypotheses that failed.

**City:** Pune (`city_id: 3`) · **Assigned locality:** Magarpatta ·
**Reference moment:** `2026-09-10T00:00:00+05:30`

---

## The ten answers

| # | Answer | |
| --- | --- | --- |
| 1 | `total_listing_records` | **3800** — the endpoint reports `total: 3466` |
| 2 | `unique_properties` | **3230** — 570 records are re-listings |
| 3 | `active_listings` | **2998** — 802 are not live, which the docs say cannot happen |
| 4 | `corrupt_listing_ids` | **42** — six contradictions, exactly seven records each |
| 5 | `total_monthly_rent` | **₹48,55,700** across 130 Magarpatta rentals |
| 6 | `avg_price_per_sqft_2bhk` | **10844.99** — 19042.07 without the area correction |
| 7 | `costliest_project` | **P30288**, ₹4,47,00,000 — not P30394 at an apparent ₹99.9 crore |
| 8 | `listings_last_7_days` | **128** — 115 if the timestamps are read as UTC |
| 9 | `fake_listing_ids` | **320** across 12 phone numbers |
| 10 | `projects_with_wrong_listing_count` | **95** of 440 |

Every one is produced by `scripts/11-answers.js` into `data/derived/answers.json`,
which `scripts/14-submission.js` copies into `submission.json`. Nothing is typed
in by hand, so the graded file cannot drift from the arithmetic behind it.

---

## Running it

Node 20.6 or newer. The analysis has no dependencies at all.

```bash
# credentials
cp .env.example .env        # then fill in IVY_API_KEY and the demo password
```

```bash
# the investigation. one network step, then everything offline.
npm run pull                # ~120 requests, writes data/raw/
npm run analyse             # profile -> units -> time -> dupes -> fraud -> corrupt
                            # -> answers -> submission -> verify
npm run verify              # re-derives all ten answers and fails on any mismatch
```

The individual steps are also runnable on their own — `npm run recon`, `npm run
probe`, `npm run dupes` and so on. Each writes a human-readable transcript to
`notes/` next to its JSON output.

## How I decided what to distrust

The reference warns it may be wrong, so I treated every sentence in it as a claim
to be tested rather than a description to be read. Three decisions shaped
everything after.

**Probe before downloading.** The first script makes twenty-one requests and
downloads nothing. Authentication, pagination and field names all fail *silently*
if you guess them wrong — and a wrong pagination model does not raise an error, it
just hands you a confidently wrong answer to question 1. So those went first. The
first request of the project, written exactly as the reference shows it, returned
401 with the correct header named in the error body. That taught me the one part of
the document that is reliable: the error messages. From then on I read them as a
map of the real API.

**Log every request.** `scripts/lib/http.js` is the only thing that touches the
network and it appends every request and response to `logs/requests.ndjson`. The
rule I set was that a finding I cannot point at a logged response for does not
ship. Findings are scored as F1, so an unreproduced claim costs exactly as much as
a missed one. The notebook carries three states — CONFIRMED, SUSPECTED, RULED
OUT — and only CONFIRMED reaches `submission.json`.

**Pull once, then stop reading records one at a time.** The endpoint sweep finds
the 404s and the renamed fields, and that is maybe a third of what is wrong here.
The rest does not live in any single response. It shows up in distributions:
price-per-square-foot grouped by source feed, carpet area against the median for
the same bedroom count, contact numbers against the names attached to them. You
cannot see any of it one record at a time.

### The residuals were the answer, three times

The brief says the first rule that fits will fit most of the data, and to look hard
at what it gets wrong. That happened three times, and each time the misfits were
the actual finding.

**Plots.** My first impossibility rule was `carpet_area >= super_built_up_area`,
which flagged 143 records — and the same 143 for `bedroom <= 0` and `bathroom <= 0`.
I nearly reported 143 corrupt records. They are `property_type: "plot"`: land has
no bedrooms, no bathrooms and no floors, and its carpet area equals its built-up
area. Conditioning on property type drops all 136 plots and leaves **7** — and
separately surfaces **7 apartments and builder floors on floors 4 to 29 with no
bedrooms at all**, which the naive rule had buried among the plots and which are
genuinely impossible.

**Project prices.** "`price_min` is in lakhs and `price_max` is in crores" fits 418
of 440 projects. It is wrong. The unit follows the *value*, not the field: lakhs
below ₹1 crore, crores at or above. The proof is an empty quadrant — split both
fields at a served value of 10 and you get 97 crore/crore, 321 lakh/crore, 22
lakh/lakh, and **exactly zero** in the impossible combination of a minimum in
crores with a maximum in lakhs, where a per-field rule would put about 24. The 22
records the simple rule misclassifies are precisely the ones question 7 turns on.

**Fraud.** My first hypothesis was that one number posting as owner *and* builder
*and* agent across nine localities was the tell. It describes 557 of the 642
contacts. I had only looked at the top of a table sorted by volume. The real
signal is the reverse — many *names* on one number — and it covers 12 contacts.

### The technique I would reuse

Unit errors are best found with **unit-invariant ratios**, and when those fail,
with **peer-normalised scores** rather than absolute thresholds.

`carpet_area / super_built_up_area` sits at 0.6–0.8 for a real property whatever
unit both fields are in, so it separates "wrong unit" from "genuinely small flat"
in a way that `area < 200 ⇒ square metres` never can. It found the 7 records where
carpet strictly exceeds super built-up.

It was also completely blind to the bigger problem. Both area fields on the
affected records are converted *together*, so the ratio stays at a healthy 0.746
on exactly the 306 records that are wrong. That needed a different probe: score
each record against the median carpet area for its own `property_type` and
`bedroom` count. The result is bimodal with an empty gap — 295 records in
[0.08, 0.11), nothing below 0.06, next band at 0.30 — and the low mode's median is
0.0933 against a predicted 1/10.7639 = 0.0929. The clincher was inside one
building: in *Rohan Grand*, one feed lists a 2 BHK at `carpet_area: 73` while three
others list 921, 776 and 786 for the same building, and 73 × 10.7639 = 786.

### What I did about it

`scripts/lib/normalize.js` is the single correction layer — area units, project
price decoding, timestamp reading. It produced the ten answers, and `npm run
verify` re-derives every answer from the snapshot, so `submission.json` cannot
drift from the arithmetic that made it.

---

## What I checked that turned out to be fine

This is the part nobody can generate, so here is all of it.

**Right in the documentation:**

- **Error bodies.** `{"detail": "..."}` and genuinely useful. The 401 for a
  query-parameter key names the correct header; a bad `sort_by` returns 400 listing
  the four sortable fields; an unknown listing id returns "no such listing in your
  city". The most reliable part of the reference, and the thing that made the rest
  tractable.
- **Every documented listing filter works.** `locality`, `bhk`, `property_type`,
  `min_price`, `max_price` and `furnishing` all filter correctly, individually and
  combined, and every returned record satisfies them. I expected at least one to be
  decorative. Only `project_id` — referenced in prose, never listed as a
  parameter — is ignored.
- **Default `limit` is 20**, exactly as documented.
- **`sort_by` itself works** for `price`, `carpet_area` and `bedroom`. Only `order`
  is ignored, and only `posted_at` sorts on the wrong granularity.
- **City scoping holds.** Every one of the 5,690 records across all three
  collections is `city_id: 3`. I expected a leak from another city and there is none.
- **`listing_id` really is unique.** All 3800 distinct, all 1450 rentals, all 440
  projects. Question 2 is about records describing the same property, not repeated
  ids — which took a while to establish, and mattered, because it ruled out the easy
  reading.
- **Lowercase strings.** All ten localities, all `furnishing`, `property_type` and
  `project_status` values are lowercase as documented.
- **`project_id` is null for resale**, exactly as described — 1461 of 3800 — and
  every non-null value resolves to a real project. No orphans.
- **Rental money and areas are correct.** Rent per carpet square foot runs 22 to 60
  with p99 at 59.5 and no twelve-times tail, so no annual figures are mixed in.
  `deposit/price` runs 2 to 10 months. `carpet/super_builtup` sits between 0.690 and
  0.801 across all 1450 records — tighter than the sale listings. I spent real time
  looking for a rental unit problem because the brief mentions "correct prices and
  correct areas" for rentals and projects, and there isn't one. That phrase points
  at projects.
- **Project areas and dates.** `min_area_sqft` 607–1397 and `max_area_sqft`
  944–3545, genuinely square feet, never inverted. `launch_date` and
  `possession_date` are plain `YYYY-MM-DD`, no project launches after the reference
  moment, and none has possession before launch.
- **Rentals and projects contain no corrupt records at all.** The same six
  impossibility rules that fire 42 times on listings fire zero times on either. The
  corruption is confined to `/v1/listings`, and I checked rather than assumed.
- **Rentals contain no duplicates.** Two candidate pairs, zero survivors. The
  duplication is listings-only.
- **Offset paging is sound.** Re-fetching offset 0 and the midpoint after each crawl
  returned byte-identical records, so the ordering is stable and nothing was skipped
  or repeated. Worth establishing before trusting a count of 3800.
- **`/health`** is unauthenticated and returns status and the server clock as
  documented. It also volunteers `timezone` and `reference_date`, which the brief
  explicitly frames as not a discrepancy, so it is not reported.

**Hypotheses that were reasonable and wrong:**

- **Hour-of-day would reveal the timezone.** Humans post during the day, so the
  reading that produces a daytime-clustered histogram should be the right one.
  Posting times are uniform across the clock in both collections — coefficient of
  variation 0.07 and 0.11 — so the test has no power whatsoever on this data. Had to
  find a different discriminator, which turned out to be where each collection stops.
- **Coordinates identify a property.** They identify a *building*: 247 coordinates
  carry several records, and inspection shows a 1 BHK on floor 21 and a 4 BHK on
  floor 14 of one tower. Using lat/lng as a dedup key would have merged genuinely
  distinct flats. The failure was useful — `(lat, lng, bedroom, floor)` has zero
  collisions across all 3800, which means shared coordinates imply distinct flats and
  near-but-unequal coordinates imply a duplicate. That dichotomy is what the dedup
  rule rests on.
- **`total` counts something meaningful.** I tried `is_live` (2998, not 3466), a
  city leak (none), duplicates (570, not 334) and distinct properties (3230). It is
  none of them: `total` is `round(true count × p)` for one constant p ≈ 0.91215,
  identical across three endpoints and 23 filter combinations with zero exceptions.
  Not a semantic difference — a scaling bug.
- **The seller-written text would contradict the structured fields.** "A seller can
  write anything" reads like an invitation to look. Every description that states a
  BHK agrees with the `bedroom` field, and every one names its record's own
  `locality`. Only two descriptions are reused across listings. It is the rental
  *title* that lies, not the description — and it lies on all 1450 records, which is
  systematic rather than seller-driven.
- **Fraud would show as listing volume.** A contact with thirty listings looked
  damning until I noticed several with 3–5 staff names, always role `agent`, which is
  just an agency line. Volume alone would either miss the planted set or drag in real
  agencies; 15 unflagged contacts hold 10–13 listings each.
- **`/auth/logout` would invalidate the token.** It returns `{"ok": true}` and the
  token keeps working — so this one *is* a finding, but I checked it expecting the
  documentation to be right.
- **The whole `magichomes` feed would be in square metres.** Only 306 of its 760
  records are. The feed correlates perfectly and still is not the rule, so the
  detection is per record.
- **The refresh endpoint would rotate the token.** The first refresh returned a
  byte-identical access token, which looked like a bug. It is `iat` having
  one-second granularity — both calls landed in the same second, so the payload and
  therefore the token are identical. Not reported, because it is not a discrepancy.

**Seen but not reported, because I could not reproduce it cleanly:** a 3σ cluster of
~13 extra listings in the final three hours before the reference moment, which
survives both timezone readings and may be deliberate padding around the question 8
boundary; and `is_verified` being true on 85% of the fraudulent listings against 62%
overall, which is suggestive of the badge being gameable but is a correlation inside
a set I selected on other grounds, so reporting it as a separate finding would be
double-counting.

---

## What I would do with another two days

1. **Attack question 2 harder.** 3230 rests on one rule that plateaus well under
   sensitivity analysis, and 570 duplicates is a big claim. I would build a proper
   pairwise scorer over all 3800 records rather than blocking on ten exact fields,
   and check whether any duplicate pair disagrees on a structural field — my
   blocking would miss it by construction, and question 2's ±1% tolerance is 32
   properties wide.
2. **Explain the 0.91215 constant.** Knowing `total` is scaled is enough to answer
   question 1, but not enough to know *why*. I would page a filter whose true count
   is tiny and watch how `total` rounds, to distinguish a sampled count from a
   deliberate multiplier.
3. **Chase the boundary cluster.** The 13 extra listings in the last three hours
   before the reference moment are either sampling noise I have mischaracterised or a
   deliberate trap around question 8. Either way I would rather know.
4. **Test the rate limit and the 403 path properly.** The reference documents a 403
   for "credentials belong to a different key" and 429 for the rate limit. I never
   triggered either, so neither is confirmed nor ruled out, and both are gaps in the
   findings list rather than absences from the API.
5. **Cross-check `is_verified` against everything.** It is the one field whose
   documented meaning ("our operations team has checked the listing") I have no way
   to test, and it is true on 85% of the listings I believe are fake.

---

## Layout

```
scripts/            the investigation, in the order it happened
  lib/http.js       the only thing that touches the network; logs every call
  lib/normalize.js  the single correction layer - units, prices, timestamps
  00-recon.js       21 requests, no download: auth, pagination, field names
  01-pull.js        the full dataset, with a pager that checks its own work
  02-profile.js     distributions across all 5,690 records
  03-units.js       the two unit errors, found without absolute thresholds
  04-time.js        which timezone the naive timestamps are in
  05-dupes.js       3800 records -> 3230 properties, with sensitivity analysis
  06-fraud.js       both hypotheses, the rejected one kept and labelled
  07-corrupt.js     six contradictions, and why plots are not among them
  08/09/10-probe*   filters, sorting, endpoint paths, saved listings
  11-answers.js     the ten answers -> data/derived/answers.json
  13-verify.js      re-derives everything; exits non-zero on any mismatch
  14-submission.js  assembles submission.json, evidence ids and all
notes/              the notebook, plus a transcript from every script
data/raw/           the snapshot every number is reproducible from
submission.json     the ten answers and 36 findings
```

`logs/requests.ndjson` is gitignored — it is large and regenerated by the
scripts — but every finding is reproducible by re-running the script named in its
`how_found`.

## Tools

I used Claude (via Kiro) throughout: writing the scripts and the prose, and as a
second pair of eyes on the analysis. It was fast at the mechanical
work — sweeping endpoints, diffing field names against the reference — and it did
not produce the hypotheses. Deciding to score areas against a
per-bedroom median instead of a threshold, spotting that the empty quadrant is what
proves the project price rule, and noticing that only the IST reading puts both
collections under one cap were the parts that took actual thinking, and they are the
parts the answers turn on.

It also confidently wrote the wrong fraud rule into a file after I had already
disproved it. That is why `npm run verify` exists.
