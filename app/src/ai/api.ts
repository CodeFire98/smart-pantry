import { daysBetween, isoDate, type AiFilters, type Catalog, type JournalEntry, type Kitchen, type RawDraft, type Recipe, type ScanItem } from '../engine'
import { ApiError } from '../swiggy/api'

/** What the AI sees about the kitchen. Built fresh for each request; nothing is stored on the server. */
export function kitchenContext(kitchen: Kitchen, catalog: Catalog, journal: JournalEntry[], recipes: Recipe[]) {
  const today = isoDate()
  const amount = (id: string) => { const it = kitchen.items[id]; const u = catalog[id]?.unit; return u ? `${it?.q ?? 0} ${u}` : ['out', 'low', 'half', 'full'][it?.l ?? 0] }
  const inStock = Object.keys(kitchen.items).filter(id => catalog[id] && ((kitchen.items[id].q ?? kitchen.items[id].l ?? 0) > 0))
  return {
    catalog: Object.entries(catalog).map(([id, c]) => ({ id, name: c.name, unit: c.unit })),
    inStock: inStock.map(id => ({ id, amount: amount(id) })),
    expiring: inStock.filter(id => { const e = kitchen.items[id].exp; return e && daysBetween(today, e) <= 2 }).map(id => catalog[id].name),
    equipment: kitchen.equipment,
    journal: journal.slice(0, 25).map(j => ({ dish: j.recipeName, version: j.tier, rating: j.rating, note: j.note })),
    dishes: recipes.map(r => r.name)
  }
}
type Ctx = ReturnType<typeof kitchenContext>

async function post<T>(action: string, body: Record<string, unknown>): Promise<T> {
  let r: Response
  try {
    r = await fetch(`/api/ai/${action}`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  } catch { throw new ApiError(0, 'You seem to be offline. AI needs a connection.') }
  const data = await r.json().catch(() => ({})) as Record<string, unknown>
  if (!r.ok) throw new ApiError(r.status, String(data.error ?? `AI request failed (${r.status})`), data.reason as string | undefined)
  return data as T
}

export const ai = {
  suggest: (context: Ctx) => post<{ recipes: RawDraft[] }>('suggest', { context }),
  draft: (context: Ctx, request: string) => post<{ recipe: RawDraft }>('draft', { context, request }),
  parse: (context: Ctx, text: string, tags: string[]) => post<{ filters: AiFilters }>('parse', { context: { catalog: context.catalog, dishes: context.dishes }, text, tags }),
  scan: (context: Ctx, kind: 'bill' | 'shelf', image: string) => post<{ items: ScanItem[] }>('scan', { context: { catalog: context.catalog }, kind, image }),
  usage: async () => {
    const r = await fetch('/api/ai/usage', { credentials: 'same-origin' })
    return r.ok ? (await r.json()) as { used: number; cap: number; model: string } : null
  }
}

/** Blob → base64 without the data: prefix. */
export const blobToB64 = (b: Blob) => new Promise<string>((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1] ?? ''); fr.onerror = rej; fr.readAsDataURL(b) })
