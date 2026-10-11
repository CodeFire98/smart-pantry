import { addDays } from './dates'
import type { Catalog, Kitchen, Unit } from './types'

export interface Amount { amount: number; unit: 'g' | 'ml' | 'pc' }

const UNIT: Record<string, Amount['unit']> = {
  kg: 'g', g: 'g', gm: 'g', gms: 'g', gram: 'g', grams: 'g',
  l: 'ml', ltr: 'ml', litre: 'ml', liter: 'ml', litres: 'ml', liters: 'ml', ml: 'ml',
  pc: 'pc', pcs: 'pc', piece: 'pc', pieces: 'pc', unit: 'pc', units: 'pc', no: 'pc', nos: 'pc', n: 'pc'
}
const SCALE: Record<string, number> = { kg: 1000, l: 1000, ltr: 1000, litre: 1000, liter: 1000, litres: 1000, liters: 1000 }

/**
 * Instamart pack text → total amount. Handles "500 g", "1 kg", "1 L", "6 pcs", "1 dozen",
 * "2 x 200 g", "Pack of 2 (500 g each)". Returns null when it can't tell.
 */
export function parseQuantity(desc: string): Amount | null {
  const s = desc.toLowerCase().replace(/,/g, '').trim()
  if (/\bdozen\b/.test(s)) { const n = Number(s.match(/(\d+(?:\.\d+)?)\s*dozen/)?.[1] ?? 1); return { amount: n * 12, unit: 'pc' } }
  const unitRe = '(kg|gms?|grams?|g|ltr|litres?|liters?|l|ml|pcs?|pieces?|units?|nos?|n)\\b'
  const multi = s.match(new RegExp(`(\\d+)\\s*[x×]\\s*(\\d+(?:\\.\\d+)?)\\s*${unitRe}`))
  if (multi) return toAmount(Number(multi[1]) * Number(multi[2]), multi[3])
  const base = s.match(new RegExp(`(\\d+(?:\\.\\d+)?)\\s*${unitRe}`))
  const packOf = Number(s.match(/pack of (\d+)/)?.[1] ?? 1)
  if (base) return toAmount(packOf * Number(base[1]), base[2])
  if (/^\d+$/.test(s)) return { amount: Number(s), unit: 'pc' }
  return null
}

function toAmount(n: number, unit: string): Amount | null {
  const u = UNIT[unit]
  return u ? { amount: Math.round(n * (SCALE[unit] ?? 1) * 100) / 100, unit: u } : null
}

/** How much one Instamart pack adds to the pantry, in the ingredient's own unit. Falls back to the catalog pack. */
export function packAmount(id: string, quantityDescription: string | undefined, catalog: Catalog): number | null {
  const ing = catalog[id]
  if (!ing?.unit) return null
  const q = quantityDescription ? parseQuantity(quantityDescription) : null
  if (q && q.unit === ing.unit) return q.amount
  return ing.sku?.pack ?? null
}

const singular = (w: string) => (w.length > 3 && w.endsWith('es') && !w.endsWith('ses') ? w.slice(0, -2) : w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w)
const words = (s: string) => s.toLowerCase().replace(/[^a-z ]/g, ' ').split(/\s+/).filter(Boolean).map(singular)

/**
 * Map an Instamart order line to an ingredient. A product you picked before (same item id or name) wins; otherwise the ingredient
 * whose name (or id) words all appear in the line, preferring the most specific (most words).
 */
export function matchOrderItem(name: string, kitchen: Pick<Kitchen, 'skuMap'>, catalog: Catalog, itemId?: string | null): { id: string; via: 'picked' | 'name' } | null {
  const lower = name.toLowerCase().trim()
  for (const [id, pick] of Object.entries(kitchen.skuMap ?? {})) {
    if ((itemId && (pick.spinId === itemId || pick.skuId === itemId)) || pick.name.toLowerCase().trim() === lower) return { id, via: 'picked' }
  }
  const have = new Set(words(name))
  let best: { id: string; score: number } | null = null
  for (const [id, ing] of Object.entries(catalog)) {
    for (const cand of [words(ing.name), words(id.replace(/_/g, ' ')), ...(ing.aliases ?? []).map(words)]) {
      if (cand.length && cand.every(w => have.has(w)) && (!best || cand.length > best.score)) best = { id, score: cand.length }
    }
  }
  return best ? { id: best.id, via: 'name' } : null
}

export interface RestockLine { id: string; amount: number | null }

/** Add exact amounts (or refill level items) with fresh expiry dates; drops those items from the list. */
export function restockAmounts(lines: RestockLine[], kitchen: Kitchen, catalog: Catalog, today: string): Kitchen {
  const items = structuredClone(kitchen.items)
  for (const { id, amount } of lines) {
    const ing = catalog[id]
    if (!ing) continue
    const it = (items[id] ??= {})
    if (ing.unit) it.q = (it.q ?? 0) + (amount ?? ing.sku?.pack ?? 1)
    else it.l = 3
    delete it.unsure
    if (ing.kind === 'per' && ing.shelf > 0) it.exp = addDays(today, ing.shelf)
  }
  const ids = new Set(lines.map(l => l.id))
  return { ...kitchen, items, list: kitchen.list.filter(x => !ids.has(x)) }
}

export const unitLabel = (u: Unit, n: number) => (u === 'pc' ? `${n}` : u ? `${n} ${u}` : '')

/** How much one +/− tap changes an item: the ingredient's own step, else one pack (pieces move by 1). */
export function stepFor(id: string, catalog: Catalog): number {
  const ing = catalog[id]
  if (!ing?.unit) return 1
  if (ing.step) return ing.step
  if (ing.unit === 'pc') return 1
  return ing.sku?.pack ?? 100
}
