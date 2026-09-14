const IST_OFFSET_MIN = 5 * 60 + 30

/**
 * Sale listing posted_at values have no offset and are IST wall-clock. Trusting
 * Date.parse would interpret them in the browser's own zone, so parse as +05:30
 * explicitly. Rental posted_at values carry a Z and are already real UTC.
 */
export function parseStamp(stamp) {
  if (!stamp) return null
  if (String(stamp).endsWith('Z')) {
    const d = new Date(stamp)
    return Number.isNaN(d.getTime()) ? null : d
  }
  const [date, time] = String(stamp).split('T')
  if (!date) return null
  const [y, m, d] = date.split('-').map(Number)
  const [h, min, s = 0] = (time || '00:00:00').split(':').map(Number)
  return new Date(Date.UTC(y, m - 1, d, h, min, s) - IST_OFFSET_MIN * 60_000)
}

export function formatStamp(stamp) {
  const d = parseStamp(stamp)
  return d
    ? d.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })
    : null
}