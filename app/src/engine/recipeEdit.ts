import { parseSlot } from './availability'
import type { Recipe } from './types'

/** One ingredient line in the recipe editor. */
export interface IngRow { id: string; q: number | null; opt: boolean; subId?: string; subQ?: number | null }

export function slotToRow(slot: string): IngRow {
  const s = parseSlot(slot)
  const sub = s.alts[1]
  return { id: s.main, q: s.need, opt: s.opt, ...(sub ? { subId: sub.id, subQ: sub.q } : {}) }
}

export function rowToSlot(r: IngRow): string {
  const part = (id: string, q: number | null | undefined) => (q != null && q > 0 ? `${id}:${q}` : id)
  return `${r.opt ? '?' : ''}${part(r.id, r.q)}${r.subId ? `|${part(r.subId, r.subQ)}` : ''}`
}

/**
 * A stored recipe record. A full recipe whose id matches a built-in replaces it;
 * `hidden` hides it from suggestions; `reset` restores the built-in; `deletedAt` removes your own.
 */
export type RecipeRecord = Partial<Recipe> & { id: string; hidden?: boolean; reset?: boolean; deletedAt?: number; updatedAt?: number }

export interface ResolvedRecipes {
  /** What Today / I want / dish pages use. */
  recipes: Recipe[]
  /** Hidden dishes (restorable). */
  hidden: Recipe[]
  /** Built-in ids you've edited. */
  edited: Set<string>
}

const isFull = (r: RecipeRecord): r is Recipe & RecipeRecord => !!r.name && Array.isArray(r.tiers) && r.tiers.length > 0 && Array.isArray(r.meals)

export function resolveRecipes(builtIn: Recipe[], records: RecipeRecord[]): ResolvedRecipes {
  const byId = new Map(records.map(r => [r.id, r]))
  const builtInIds = new Set(builtIn.map(r => r.id))
  const recipes: Recipe[] = [], hidden: Recipe[] = [], edited = new Set<string>()
  for (const b of builtIn) {
    const rec = byId.get(b.id)
    if (!rec || rec.reset) { recipes.push(b); continue }
    const r = isFull(rec) ? (edited.add(b.id), { ...b, ...rec }) as Recipe : b
    ;(rec.hidden ? hidden : recipes).push(r)
  }
  for (const rec of records) {
    if (builtInIds.has(rec.id) || rec.deletedAt || rec.reset || !isFull(rec)) continue
    ;(rec.hidden ? hidden : recipes).push(rec as Recipe)
  }
  return { recipes, hidden, edited }
}

export function newRecipeId(name: string, taken: Set<string>): string {
  const base = 'my_' + (name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || 'dish')
  let id = base, n = 2
  while (taken.has(id)) id = `${base}_${n++}`
  return id
}
