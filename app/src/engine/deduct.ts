import { have, tierSlots } from './availability'
import { addDays } from './dates'
import type { Catalog, Kitchen, Recipe } from './types'

export interface Used { id: string; amount: number | null }

/**
 * What cooking tier `i` takes out of the kitchen. Quantity items lose exactly the recipe amount
 * (or what's left, if short); level items drop one level; staples are never touched.
 */
export function deduct(r: Recipe, i: number, kitchen: Kitchen, catalog: Catalog): { kitchen: Kitchen; used: Used[] } {
  const items = structuredClone(kitchen.items)
  const used: Used[] = []
  for (const sl of tierSlots(r, i)) {
    const h = have(sl, { ...kitchen, items }, catalog)
    if (!h.ok || !h.id || catalog[h.id].kind === 'stp') continue
    const it = items[h.id]
    if (catalog[h.id].unit) {
      const need = sl.alts.find(a => a.id === h.id)?.q ?? 1
      const take = Math.min(it.q ?? 0, need)
      it.q = (it.q ?? 0) - take
      used.push({ id: h.id, amount: take })
    } else {
      it.l = Math.max(0, (it.l ?? 0) - 1)
      used.push({ id: h.id, amount: null })
    }
  }
  return { kitchen: { ...kitchen, items }, used }
}

/** Add one Instamart pack of each item (or refill a level item) with a fresh expiry date. */
export function restock(ids: string[], kitchen: Kitchen, catalog: Catalog, today: string): Kitchen {
  const items = structuredClone(kitchen.items)
  for (const id of ids) {
    const ing = catalog[id]
    if (!ing) continue
    const it = (items[id] ??= {})
    if (ing.unit) it.q = (it.q ?? 0) + (ing.sku?.pack ?? 1)
    else it.l = 3
    delete it.unsure
    if (ing.kind === 'per' && ing.shelf > 0) it.exp = addDays(today, ing.shelf)
  }
  return { ...kitchen, items, list: kitchen.list.filter(x => !ids.includes(x)) }
}
