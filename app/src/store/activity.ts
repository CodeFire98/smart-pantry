import type { ActivityEvent } from '../engine'
import { notifyChange } from './changes'
import { db } from './db'

const MAX_LOCAL = 3000
/** The same search or dish opened again within this window is one event, not several. */
const REPEAT_MS = 5 * 60_000

/** Record something the cook did. Never throws: logging must not break the action itself. */
export async function logActivity(e: Omit<ActivityEvent, 'uid' | 't'>): Promise<void> {
  try {
    const t = Date.now()
    if (e.type === 'search' || e.type === 'open') {
      const recent = await db.activity.where('t').above(t - REPEAT_MS).toArray()
      if (recent.some(x => x.type === e.type && x.text === e.text && x.id === e.id)) return
    }
    const clean: ActivityEvent = { uid: crypto.randomUUID(), t, type: e.type }
    if (e.text) clean.text = e.text.trim().slice(0, 120)
    if (e.id) clean.id = e.id
    if (e.names?.length) clean.names = e.names.slice(0, 40).map(n => n.slice(0, 60))
    if (e.n != null) clean.n = e.n
    await db.activity.add({ ...clean, synced: 0 })
    const n = await db.activity.count()
    if (n > MAX_LOCAL) await db.activity.orderBy('t').limit(n - MAX_LOCAL).delete()
    notifyChange()
  } catch { /* ignore */ }
}

/** Everything logged, oldest first, without the local sync flag (for download / the profile). */
export async function allActivity(): Promise<ActivityEvent[]> {
  return (await db.activity.orderBy('t').toArray()).map(({ synced: _s, ...e }) => e)
}
