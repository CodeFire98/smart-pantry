import { HttpError, body, route } from './_lib/http.js'
import { redis } from './_lib/redis.js'
import { requireSession } from './_lib/session.js'
import { SYNC, activitySince, addActivity, casKitchen, cleanActivity, readHash, upsertNewer } from './_lib/sync.js'

type Entry = { uid: string; updatedAt?: number; at: number; photoId?: number }
type Recipe = { id: string; updatedAt?: number }

/**
 * GET ?activitySince=ms → {kitchen: {doc, rev} | null, journal, recipes, activity (received after activitySince)}
 * POST {kitchen?: {doc, baseRev}, journal?: Entry[], recipes?: Recipe[], activity?: Event[]}
 *      → {rev} or 409 {reason: 'conflict', kitchen} when another device saved the kitchen first.
 * Journal entries and recipes are upserted per record, newest edit wins. Activity events are append-only.
 */
export default route(['GET', 'POST'], async req => {
  requireSession(req)
  if (req.method === 'GET') {
    const raw = await redis().get<{ doc: unknown; rev: number } | string>(SYNC.kitchen)
    const k = typeof raw === 'string' ? JSON.parse(raw) : raw
    const since = Number(req.query.activitySince) || 0
    return { kitchen: k ? { doc: k.doc, rev: k.rev } : null, journal: await readHash<Entry>(SYNC.journal), recipes: await readHash<Recipe>(SYNC.recipes), activity: await activitySince(since) }
  }
  const b = body<{ kitchen?: { doc: unknown; baseRev: number }; journal?: Entry[]; recipes?: Recipe[]; activity?: unknown[] }>(req)
  const journal = Array.isArray(b.journal) ? b.journal.slice(0, 500) : []
  const recipes = Array.isArray(b.recipes) ? b.recipes.slice(0, 200) : []
  if (journal.some(j => typeof j?.uid !== 'string' || !/^[A-Za-z0-9-]{8,64}$/.test(j.uid))) throw new HttpError(400, 'Invalid journal entry id')
  if (recipes.some(r => typeof r?.id !== 'string' || !/^[a-z0-9_]{1,60}$/.test(r.id))) throw new HttpError(400, 'Invalid recipe id')
  // photoId is a device-local Dexie id: never store it on the server.
  await upsertNewer(SYNC.journal, journal.map(({ photoId: _p, ...j }) => j), j => j.uid, j => j.updatedAt ?? j.at)
  await upsertNewer(SYNC.recipes, recipes, r => r.id, r => r.updatedAt ?? 0)
  await addActivity(cleanActivity(Array.isArray(b.activity) ? b.activity.slice(0, 500) : []))
  let rev: number | null = null
  if (b.kitchen) {
    if (!b.kitchen.doc || typeof b.kitchen.doc !== 'object' || typeof b.kitchen.baseRev !== 'number') throw new HttpError(400, 'Invalid kitchen')
    const res = await casKitchen(b.kitchen.doc, b.kitchen.baseRev)
    if (!res.ok) throw new HttpError(409, 'Another device saved first.', { reason: 'conflict', kitchen: res.current })
    rev = res.rev
  }
  return { rev }
})
