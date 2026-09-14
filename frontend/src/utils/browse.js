export function median(values) {
  const sorted = [...values].sort((a, b) => a - b)
  if (!sorted.length) return 0
  const mid = sorted.length >> 1
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

export function groupCounts(rows, key) {
  const counts = {}
  for (const row of rows) {
    const k = row[key]
    counts[k] = (counts[k] || 0) + 1
  }
  return counts
}