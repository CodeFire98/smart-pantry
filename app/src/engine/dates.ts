const DAY = 86_400_000

/** Local calendar date as YYYY-MM-DD. */
export function isoDate(d: Date = new Date()): string {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  return isoDate(new Date(y, m - 1, d + days))
}

/** Whole days from `today` until `iso` (negative once past). */
export function daysBetween(today: string, iso: string): number {
  const [a, b] = [today, iso].map(s => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d) })
  return Math.round((b - a) / DAY)
}

export const DAY_MS = DAY
