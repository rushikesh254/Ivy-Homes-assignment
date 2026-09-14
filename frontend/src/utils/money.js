export const LAKH = 1_00_000
export const CRORE = 1_00_00_000

export function formatRupees(amount) {
  const value = Number(amount)
  if (!Number.isFinite(value) || value <= 0) return '—'
  if (value >= CRORE) return `₹${(value / CRORE).toFixed(2)} Cr`
  if (value >= LAKH) return `₹${(value / LAKH).toFixed(2)} L`
  return `₹${value.toLocaleString('en-IN')}`
}

/**
 * Project price_min/price_max are Indian display units, not plain rupees:
 * below ₹1 crore the served number is lakhs (80.0 = ₹80 lakh), at/above it is
 * crores (3.22 = ₹3.22 crore). The unit is decided by the value itself.
 */
export function decodeDisplayPrice(display) {
  const value = Number(display)
  if (!Number.isFinite(value)) return null
  return value < 10 ? value * CRORE : value * LAKH
}

export function displayUnitOf(display) {
  const value = Number(display)
  return Number.isFinite(value) ? (value < 10 ? 'crore' : 'lakh') : 'unknown'
}