import type { ActivityEvent, JournalEntry, TasteProfile } from './types'

export const PROFILE_EVERY_DAYS = 7
export const PROFILE_MIN_NEW = 10

const DAY = 86_400_000
const mealOf = (t: number) => { const h = new Date(t).getHours(); return h < 11 ? 'breakfast' : h < 16 ? 'lunch' : h < 19 ? 'snack' : 'dinner' }
const top = (m: Map<string, number>, n: number) => [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n)
const bump = (m: Map<string, number>, k: string | undefined) => { const key = k?.trim(); if (key) m.set(key, (m.get(key) ?? 0) + 1) }

export interface ActivitySummary {
  days: number
  events: number
  searches: Array<[string, number]>
  opened: Array<[string, number]>
  cooked: Array<{ dish: string; times: number; rating: number | null; versions: string[]; notes: string[] }>
  listed: Array<[string, number]>
  ordered: Array<[string, number]>
  scanned: Array<[string, number]>
  recipesAdded: string[]
  cookTimes: Record<string, number>
}

/** Compact counts of what the cook has done, for the AI to turn into a taste profile. Newest 180 days only. */
export function summarizeActivity(events: ActivityEvent[], journal: JournalEntry[], now = Date.now()): ActivitySummary {
  const since = now - 180 * DAY
  const ev = events.filter(e => e.t >= since)
  const js = journal.filter(j => !j.deletedAt && j.at >= since)
  const searches = new Map<string, number>(), opened = new Map<string, number>(), listed = new Map<string, number>()
  const ordered = new Map<string, number>(), scanned = new Map<string, number>(), cookTimes: Record<string, number> = {}
  const recipesAdded: string[] = []
  for (const e of ev) {
    if (e.type === 'search') bump(searches, e.text?.toLowerCase())
    else if (e.type === 'open') bump(opened, e.names?.[0])
    else if (e.type === 'list') e.names?.forEach(n => bump(listed, n.toLowerCase()))
    else if (e.type === 'order' || e.type === 'restock') e.names?.forEach(n => bump(ordered, n.toLowerCase()))
    else if (e.type === 'scan') e.names?.forEach(n => bump(scanned, n.toLowerCase()))
    else if (e.type === 'recipe' && e.names?.[0]) recipesAdded.push(`${e.names[0]}${e.text === 'ai' ? ' (AI draft)' : ''}`)
  }
  const cooks = new Map<string, { times: number; ratings: number[]; versions: Set<string>; notes: string[] }>()
  for (const j of [...js].sort((a, b) => b.at - a.at)) {
    const c = cooks.get(j.recipeName) ?? { times: 0, ratings: [], versions: new Set<string>(), notes: [] }
    c.times++; if (j.rating) c.ratings.push(j.rating); c.versions.add(j.tier); if (j.note.trim() && c.notes.length < 3) c.notes.push(j.note.trim().slice(0, 140))
    cooks.set(j.recipeName, c)
    const m = mealOf(j.at); cookTimes[m] = (cookTimes[m] ?? 0) + 1
  }
  const first = Math.min(...ev.map(e => e.t), ...js.map(j => j.at), now)
  return {
    days: Math.max(1, Math.ceil((now - first) / DAY)),
    events: ev.length,
    searches: top(searches, 20), opened: top(opened, 20), listed: top(listed, 25), ordered: top(ordered, 30), scanned: top(scanned, 20),
    cooked: [...cooks].sort((a, b) => b[1].times - a[1].times).slice(0, 25).map(([dish, c]) => ({
      dish, times: c.times, versions: [...c.versions],
      rating: c.ratings.length ? Math.round(c.ratings.reduce((a, b) => a + b, 0) / c.ratings.length * 10) / 10 : null, notes: c.notes
    })),
    recipesAdded: recipesAdded.slice(-15),
    cookTimes
  }
}

/** Plain-text version of the summary for the prompt. */
export function summaryText(s: ActivitySummary): string {
  const list = (xs: Array<[string, number]>) => xs.map(([k, n]) => `${k}${n > 1 ? ` ×${n}` : ''}`).join(', ') || 'none'
  return [
    `PERIOD: last ${s.days} day${s.days === 1 ? '' : 's'}, ${s.events} logged actions`,
    `COOKED:\n${s.cooked.map(c => `- ${c.dish} ×${c.times} (versions: ${c.versions.join(', ')})${c.rating ? ` avg ${c.rating}/5` : ''}${c.notes.length ? ` notes: ${c.notes.map(n => `"${n}"`).join('; ')}` : ''}`).join('\n') || '- nothing yet'}`,
    `COOKS BY TIME OF DAY: ${Object.entries(s.cookTimes).map(([m, n]) => `${m} ${n}`).join(', ') || 'none'}`,
    `SEARCHED FOR: ${list(s.searches)}`,
    `OPENED (looked at): ${list(s.opened)}`,
    `ADDED TO SHOPPING LIST: ${list(s.listed)}`,
    `ORDERED / RESTOCKED: ${list(s.ordered)}`,
    `SCANNED FROM BILLS / SHELF: ${list(s.scanned)}`,
    `NEW RECIPES SAVED: ${s.recipesAdded.join(', ') || 'none'}`
  ].join('\n')
}

/** Rewrite the profile when there's none yet and enough to go on, or weekly once enough new has happened. */
export function profileDue(p: TasteProfile | undefined, events: number, now = Date.now()): boolean {
  if (!p) return events >= PROFILE_MIN_NEW
  return now - p.at >= PROFILE_EVERY_DAYS * DAY && events - p.events >= PROFILE_MIN_NEW
}
