import {
  BarChart3, TrendingUp, Home, MapPin,
  TriangleAlert, Info, BedDouble, Shield, Copy, CircleX,
} from 'lucide-react'
import { useAllListings, useAllRentals, useAllProjects } from '../hooks/useData'
import { normaliseListing, median, groupCounts, formatRupees, parseStamp } from '../utils'
import { REFERENCE_DATE, ADVERTISED_TOTALS, SNAPSHOT_TOTALS, FAKE_LISTINGS, BROKEN_LISTINGS, COPY_LISTINGS } from '../data/findings'
import { PageTitle, Spinner, StatTile } from '../components/primitives'

function SectionHeading({ children }) {
  return (
    <h2 className="text-ink-2 text-xs font-medium tracking-wider border-b border-border pb-2 mb-4 flex items-center gap-2">
      {children}
    </h2>
  )
}

const INSIGHT_TONES = {
  blue: 'border-[#6366F1]',
  amber: 'border-accent',
  red: 'border-danger',
  green: 'border-success',
  purple: 'border-[#8B5CF6]',
}

function Insight({ icon: Icon, title, text, tone = 'blue' }) {
  return (
    <div className={`border-l-2 ${INSIGHT_TONES[tone]} pl-4 py-1`}>
      <p className="text-sm font-medium text-ink flex items-center gap-2">
        <Icon className="w-3.5 h-3.5 text-ink-2" />
        {title}
      </p>
      <p className="text-xs text-ink-2 mt-1 leading-relaxed">{text}</p>
    </div>
  )
}

function Bar({ label, value, max, count }) {
  const pct = max > 0 ? (value / max) * 100 : 0
  return (
    <div className="flex items-center gap-3">
      <p className="font-data text-xs text-ink-2 w-28 capitalize shrink-0 truncate">{label}</p>
      <div className="flex-1 bg-raised rounded-full h-1.5">
        <div className="bg-accent h-1.5 rounded-full transition-all" style={{ width: `${pct}%` }} />
      </div>
      <p className="font-data text-xs text-accent-text w-12 text-right">{count}</p>
    </div>
  )
}

export default function InsightsView() {
  const { data: allListings, isLoading: loadingListings } = useAllListings()
  const { data: allRentals, isLoading: loadingRentals } = useAllRentals()
  const { data: allProjects, isLoading: loadingProjects } = useAllProjects()

  if (loadingListings || loadingRentals || loadingProjects) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-8">
        <PageTitle title="Market Insights" subtitle="Aggregating data from all listings..." />
        <Spinner message="Fetching everything for analysis (this takes ~30 seconds)..." />
      </div>
    )
  }

  const listings = (allListings || []).map(normaliseListing)
  const live = listings.filter((l) => l.is_live)
  const rentals = allRentals || []
  const projects = allProjects || []

  const prices = live.map((l) => l.price).filter(Boolean)
  const rates = live.filter((l) => l.price && l.carpetSqft > 0).map((l) => Math.round(l.price / l.carpetSqft))
  const rentPrices = rentals.map((r) => r.price).filter(Boolean)

  const byLocality = groupCounts(live, 'locality')
  const localitySorted = Object.entries(byLocality).sort((a, b) => b[1] - a[1]).slice(0, 10)
  const maxLocality = Math.max(0, ...localitySorted.map(([, c]) => c))

  const byBhk = Object.entries(groupCounts(live, 'bedroom'))
    .map(([k, c]) => [Number(k), c])
    .sort((a, b) => a[0] - b[0])
  const maxBhk = Math.max(0, ...byBhk.map(([, c]) => c))

  const reference = new Date(REFERENCE_DATE)
  const weekAgo = new Date(reference.getTime() - 7 * 24 * 3600 * 1000)
  const recent = listings.filter((l) => {
    const d = parseStamp(l.posted_at)
    return d && d >= weekAgo && d < reference
  }).length

  const costliest = projects.reduce((best, p) => {
    const capped = Math.min(Number(p.price_max) || 0, Number(p.price_min) || 0) || 0
    return best && capped <= best._v ? best : { ...p, _v: capped }
  }, null)
  const costliestInr = Number(costliest?.price_max) >= 10
    ? Number(costliest?.price_max) * 1_00_000
    : Number(costliest?.price_max) * 1_00_00_000

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <PageTitle title="Market Insights" subtitle="Live analytics computed from the full Pune dataset" />

      <div className="bg-card border border-border rounded-xl p-5 mb-6">
        <SectionHeading><Shield className="w-4 h-4 text-accent" /> Advertised vs actual totals</SectionHeading>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
          {[
            ['Sale listings', ADVERTISED_TOTALS.listings, SNAPSHOT_TOTALS.listings],
            ['Rentals', ADVERTISED_TOTALS.rentals, SNAPSHOT_TOTALS.rentals],
            ['Projects', ADVERTISED_TOTALS.projects, SNAPSHOT_TOTALS.projects],
          ].map(([label, advertised, snapshot]) => (
            <div key={label} className="bg-raised rounded-lg p-3">
              <p className="text-xs text-ink-3">{label}</p>
              <p className="font-data font-medium text-ink">
                {snapshot.toLocaleString()}
                <span className="text-xs font-normal text-ink-3 ml-2">(advertised {advertised.toLocaleString()})</span>
              </p>
            </div>
          ))}
        </div>
        <p className="text-xs text-ink-3 mt-3">
          A full crawl returns {listings.length.toLocaleString()} sale records vs the {ADVERTISED_TOTALS.listings.toLocaleString()} /health advertises.
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatTile label="Total listings" value={listings.length.toLocaleString()} note={`${live.length.toLocaleString()} active`} icon={Home} />
        <StatTile label="Median price" value={formatRupees(median(prices))} note="Active sale listings" icon={TrendingUp} />
        <StatTile label="Median ₹/sq.ft" value={`₹${Math.round(median(rates)).toLocaleString('en-IN')}`} note="Carpet area (sqm corrected)" icon={BarChart3} />
        <StatTile label="Total rentals" value={rentals.length.toLocaleString()} note={`Median ₹${median(rentPrices).toLocaleString('en-IN')}/mo`} icon={BedDouble} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <div className="bg-card border border-border rounded-xl p-4 flex items-center gap-3">
          <div className="p-2 bg-[#2A0F0F] rounded-lg"><CircleX className="w-5 h-5 text-danger" /></div>
          <div>
            <p className="text-2xl font-bold text-ink font-data">{BROKEN_LISTINGS.size}</p>
            <p className="text-xs text-ink-3">Corrupt records</p>
          </div>
        </div>
        <div className="bg-card border border-border rounded-xl p-4 flex items-center gap-3">
          <div className="p-2 bg-[#2A0F0F] rounded-lg"><Shield className="w-5 h-5 text-danger" /></div>
          <div>
            <p className="text-2xl font-bold text-ink font-data">{FAKE_LISTINGS.size}</p>
            <p className="text-xs text-ink-3">Suspected fake listings</p>
          </div>
        </div>
        <div className="bg-card border border-border rounded-xl p-4 flex items-center gap-3">
          <div className="p-2 bg-[#1E1508] rounded-lg"><Copy className="w-5 h-5 text-accent-text" /></div>
          <div>
            <p className="text-2xl font-bold text-ink font-data">{COPY_LISTINGS.size}</p>
            <p className="text-xs text-ink-3">Duplicate records</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <div className="bg-card border border-border rounded-xl p-5">
          <SectionHeading><MapPin className="w-4 h-4 text-accent" /> Listings by locality (top 10)</SectionHeading>
          <div className="flex flex-col gap-2.5">
            {localitySorted.map(([loc, count]) => (
              <Bar key={loc} label={loc} value={count} max={maxLocality} count={count} />
            ))}
          </div>
        </div>

        <div className="bg-card border border-border rounded-xl p-5">
          <SectionHeading><BedDouble className="w-4 h-4 text-accent" /> Listings by bedroom count</SectionHeading>
          <div className="flex flex-col gap-2.5">
            {byBhk.map(([bhk, count]) => (
              <Bar key={bhk} label={`${bhk} BHK`} value={count} max={maxBhk} count={count} />
            ))}
          </div>
          <div className="mt-4 pt-4 border-t border-border">
            <p className="text-xs text-ink-3">
              Listings posted in the 7 days before the reference date: <strong className="text-ink">{recent}</strong>
            </p>
          </div>
        </div>
      </div>

      <div className="mb-6">
        <SectionHeading><TriangleAlert className="w-4 h-4 text-accent" /> Data discoveries</SectionHeading>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-5">
          <Insight tone="amber" icon={TriangleAlert} title="API key is a header, not a query param"
            text="Docs say ?api_key=, the API really requires X-API-Key. The query-param form returns 401 with a helpful message." />
          <Insight tone="amber" icon={TriangleAlert} title="Tokens live 15 minutes, not 24 hours"
            text="Docs claim 86400s; the real expires_in is 900s. The app refreshes at expiry−60s via /auth/refresh instead of waiting for a 401." />
          <Insight tone="red" icon={TriangleAlert} title="Project prices use per-value display units"
            text="price_min/price_max are NOT rupees. Below ₹1 crore the value is lakhs; at or above, crores. A max of 99.9 = ₹99.9 lakh." />
          <Insight tone="blue" icon={Info} title="The analytics endpoint does not exist"
            text="/v1/analytics/summary returns 404. This screen computes the same aggregates from the raw listings, rentals and projects data." />
          <Insight tone="amber" icon={TriangleAlert} title="Pagination is offset-based"
            text="Docs say page=1 (1-indexed); the API uses offset=0 and answers with limit/offset/has_more — not page/page_size/total." />
          <Insight tone="red" icon={Shield} title={`Suspected fake listings: ${FAKE_LISTINGS.size}`}
            text={`${FAKE_LISTINGS.size} listing IDs sit behind contacts that each carry multiple distinct posted-by names — a generated-listings signal.`} />
          <Insight tone="amber" icon={Copy} title={`Duplicate records: ${COPY_LISTINGS.size}`}
            text={`${COPY_LISTINGS.size} records re-describe a property already counted once in the dataset.`} />
          <Insight tone="red" icon={CircleX} title={`Corrupt records: ${BROKEN_LISTINGS.size}`}
            text={`${BROKEN_LISTINGS.size} records violate what the schema says can exist (negative area, impossible counts, missing keys).`} />
          {costliest && (
            <Insight tone="green" icon={TrendingUp} title={`Costliest project: ${costliest.apartment_name}`}
              text={`${costliest.project_id} in ${costliest.locality} — decoded top price ₹${(costliestInr / 1_00_00_000).toFixed(2)} Cr.`} />
          )}
          <Insight tone="blue" icon={Info} title="Single-listing path is plural"
            text="Docs say GET /v1/listing/{id}; the real path is GET /v1/listings/{id}. The singular path returns 404." />
        </div>
      </div>
    </div>
  )
}