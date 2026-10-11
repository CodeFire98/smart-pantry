import type { JournalEntry, Kitchen, PantryItem, Recipe } from './types'

/** Kitchen fields synced as a whole (newest edit wins). `items` is merged per item instead. */
export const KITCHEN_FIELDS = ['equipment', 'list', 'skuMap', 'pendingOrders', 'customIngredients'] as const
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/** Stamp what changed between two versions of the kitchen, so another device can tell which edit is newer. */
export function stampKitchen(prev: Kitchen | undefined, next: Kitchen, now: number): Kitchen {
  const out: Kitchen = { ...next, items: { ...next.items }, fieldT: { ...next.fieldT }, tombstones: { ...next.tombstones } }
  for (const [id, it] of Object.entries(out.items)) {
    const { t: _a, ...before } = prev?.items[id] ?? {}
    const { t: _b, ...after } = it
    if (!prev?.items[id] || !same(before, after)) out.items[id] = { ...it, t: now }
  }
  for (const id of Object.keys(prev?.items ?? {})) if (!out.items[id]) out.tombstones![id] = now
  for (const f of KITCHEN_FIELDS) if (!same(prev?.[f], next[f])) out.fieldT![f] = now
  if (!same(prev?.importedOrders, next.importedOrders)) out.fieldT!.importedOrders = now
  return out
}

/**
 * Merge two copies of the kitchen. Per pantry item and per field, the newer edit wins (ties go to `b`).
 * Deleted items stay deleted unless edited after the deletion. Imported order ids are always unioned,
 * so a delivery is never added to the pantry twice.
 */
export function mergeKitchen(a: Kitchen, b: Kitchen): Kitchen {
  const tombstones: Record<string, number> = { ...a.tombstones }
  for (const [id, t] of Object.entries(b.tombstones ?? {})) tombstones[id] = Math.max(tombstones[id] ?? 0, t)
  const items: Kitchen['items'] = {}
  for (const id of new Set([...Object.keys(a.items), ...Object.keys(b.items)])) {
    const x = a.items[id], y = b.items[id]
    const pick = !x ? y : !y ? x : (x.t ?? 0) > (y.t ?? 0) ? x : y
    const deleted = tombstones[id]
    if (pick && (!deleted || (pick.t ?? 0) > deleted)) items[id] = pick
  }
  const out: Kitchen = { ...b, items, tombstones, fieldT: { ...a.fieldT, ...b.fieldT } }
  for (const f of KITCHEN_FIELDS) {
    const ta = a.fieldT?.[f] ?? 0, tb = b.fieldT?.[f] ?? 0
    ;(out as unknown as Record<string, unknown>)[f] = ta > tb ? a[f] : b[f]
    out.fieldT![f] = Math.max(ta, tb)
  }
  out.importedOrders = [...new Set([...(a.importedOrders ?? []), ...(b.importedOrders ?? [])])]
  const done = new Set(out.importedOrders)
  out.pendingOrders = (out.pendingOrders ?? []).filter(p => !done.has(p.orderId))
  return out
}

/** Per record, keep whichever copy was edited last. Returns the winners and which side each one came from. */
export function mergeRecords<T>(local: T[], remote: T[], key: (r: T) => string, time: (r: T) => number) {
  const byKey = new Map<string, { r: T; from: 'local' | 'remote' | 'same' }>()
  for (const r of remote) byKey.set(key(r), { r, from: 'remote' })
  for (const r of local) {
    const k = key(r), other = byKey.get(k)
    if (!other) byKey.set(k, { r, from: 'local' })
    else if (time(r) > time(other.r)) byKey.set(k, { r, from: 'local' })
    else if (time(r) === time(other.r)) byKey.set(k, { r: other.r, from: 'same' })
  }
  const all = [...byKey.values()]
  return { merged: all.map(x => x.r), toPush: all.filter(x => x.from === 'local').map(x => x.r), toPull: all.filter(x => x.from === 'remote').map(x => x.r) }
}

export const mergeJournal = (local: JournalEntry[], remote: JournalEntry[]) =>
  mergeRecords(local.filter(j => j.uid), remote, j => j.uid!, j => j.updatedAt ?? j.at)

export const mergeRecipes = (local: Recipe[], remote: Recipe[]) =>
  mergeRecords(local, remote, r => r.id, r => r.updatedAt ?? 0)

/** True when this device still has only the untouched starting pantry (nothing worth uploading). */
export const isPristine = (k: Kitchen) =>
  Object.values(k.items).every(i => i.t == null) && !Object.keys(k.fieldT ?? {}).length

/**
 * Before a device's first sync: stamp whatever differs from the starting pantry as edited `now`,
 * so real changes made before sync existed win over untouched starting values on other devices.
 * Expiry dates are ignored in the comparison (they're relative to when the seed was created).
 */
export function stampPreSync(local: Kitchen, seed: Kitchen, now: number): Kitchen {
  const core = (i: PantryItem | undefined) => i && { q: i.q, l: i.l, unsure: !!i.unsure }
  const items: Kitchen['items'] = {}
  for (const [id, it] of Object.entries(local.items)) items[id] = it.t == null && !same(core(it), core(seed.items[id])) ? { ...it, t: now } : it
  const fieldT = { ...local.fieldT }
  for (const f of KITCHEN_FIELDS) if (fieldT[f] == null && !same(local[f] ?? empty(f), seed[f] ?? empty(f))) fieldT[f] = now
  return { ...local, items, fieldT }
}
const empty = (f: string) => (f === 'list' || f === 'equipment' || f === 'pendingOrders' ? [] : {})
