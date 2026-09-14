import { TriangleAlert } from 'lucide-react'

export function Spinner({ message }) {
  return (
    <div className="flex flex-col items-center justify-center py-32 gap-4 text-ink-2">
      <div className="w-8 h-8 border-2 border-border-strong border-t-accent rounded-full animate-spin" />
      {message && <p className="text-sm">{message}</p>}
    </div>
  )
}

export function InlineError({ message, retry }) {
  return (
    <div className="flex flex-col items-center py-16 gap-2 text-center">
      <div className="w-12 h-12 rounded-xl bg-raised border border-border flex items-center justify-center">
        <TriangleAlert className="w-5 h-5 text-danger" />
      </div>
      <p className="font-medium text-ink-2">Something went wrong</p>
      <p className="text-xs text-ink-3 max-w-sm">{message}</p>
      {retry && (
        <button
          onClick={retry}
          className="mt-2 px-4 py-2 bg-accent text-surface text-sm font-semibold rounded-lg hover:bg-[#D97706] transition-colors"
        >
          Try again
        </button>
      )}
    </div>
  )
}

export function Empty({ title, hint, icon: Icon }) {
  return (
    <div className="flex flex-col items-center py-24 gap-3 text-ink-3">
      {Icon && (
        <div className="w-16 h-16 rounded-2xl bg-raised border border-border flex items-center justify-center">
          <Icon className="w-8 h-8 text-accent opacity-60" />
        </div>
      )}
      <p className="font-medium text-ink-2 text-sm">{title}</p>
      {hint && <p className="text-ink-3 text-xs max-w-xs text-center">{hint}</p>}
    </div>
  )
}

const TAG = {
  neutral: 'bg-[#1E2230] text-ink-2 border border-border',
  blue: 'bg-[#1A1F35] text-[#818CF8] border border-[#2D3A6B]',
  green: 'bg-[#0F2820] text-[#34D399] border border-[#1A4A35]',
  amber: 'bg-[#1E1508] text-[#FCD34D] border border-[#4A3208]',
  red: 'bg-[#2A0F0F] text-[#F87171] border border-[#5A1A1A]',
}

export function Tag({ children, tone = 'neutral' }) {
  return (
    <span
      className={`inline-flex px-2 py-0.5 rounded-md text-[11px] font-medium tracking-wide border ${TAG[tone]}`}
    >
      {children}
    </span>
  )
}

export function StatTile({ label, value, note, icon: Icon }) {
  return (
    <div className="bg-card border border-border rounded-xl p-5 relative overflow-hidden">
      <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-accent rounded-l-xl" />
      <p className="text-ink-2 text-xs mb-2">{label}</p>
      <p className="font-data text-2xl font-medium text-ink">{value}</p>
      {note && <p className="text-ink-3 text-xs mt-1">{note}</p>}
      {Icon && (
        <div className="absolute right-4 top-4 text-accent opacity-20">
          <Icon className="w-10 h-10" />
        </div>
      )}
    </div>
  )
}

export function PageTitle({ title, subtitle, children }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
      <div>
        <h1 className="text-xl font-semibold text-ink">{title}</h1>
        {subtitle && <p className="text-ink-2 text-sm font-data mt-1">{subtitle}</p>}
      </div>
      {children}
    </div>
  )
}

export function Pager({ offset, limit, total, hasMore, onJump }) {
  const page = Math.floor(offset / limit) + 1
  const pages = Math.max(1, Math.ceil(total / limit))
  return (
    <div className="flex items-center justify-between mt-8 pt-4 border-t border-border">
      <p className="font-data text-xs text-ink-3">
        {offset + 1}–{Math.min(offset + limit, total)} of {total.toLocaleString()}
      </p>
      <div className="flex gap-2">
        <button
          onClick={() => onJump(Math.max(0, offset - limit))}
          disabled={offset === 0}
          className="px-3 py-1.5 text-sm bg-raised border border-border text-ink-2 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed hover:border-accent hover:text-accent-text transition-colors"
        >
          Prev
        </button>
        <span className="px-3 py-1.5 text-sm text-ink-2 font-data">{page} / {pages}</span>
        <button
          onClick={() => onJump(offset + limit)}
          disabled={!hasMore}
          className="px-3 py-1.5 text-sm bg-raised border border-border text-ink-2 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed hover:border-accent hover:text-accent-text transition-colors"
        >
          Next
        </button>
      </div>
    </div>
  )
}