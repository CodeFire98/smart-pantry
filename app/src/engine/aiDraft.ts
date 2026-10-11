import { matchOrderItem, packAmount } from './quantity'
import { newRecipeId, rowToSlot, type IngRow } from './recipeEdit'
import { RecipeSchema } from './schema'
import type { Art, Catalog, CustomIngredient, Kitchen, Meal, Recipe } from './types'

/** What Gemini returns for one recipe (shape enforced by its response schema, but never trusted). */
export interface RawDraft {
  name?: string; why?: string; meals?: string[]; tags?: string[]; plate?: string; color?: string
  tiers?: Array<{ name?: string; mins?: number; effort?: number; steps?: string[]
    ingredients?: Array<{ id?: string; amount?: number; optional?: boolean; substitute?: string }> }>
  newIngredients?: Array<{ id?: string; name?: string; unit?: string; cat?: string }>
}
export interface Draft { recipe: Recipe; why: string; newIngredients: Record<string, CustomIngredient> }

const MEALS: Meal[] = ['breakfast', 'lunch', 'snack', 'dinner']
const CATS = ['fridge', 'fresh', 'freezer', 'shelf', 'spices', 'sauces']
/** Trim to a whole word so a version name never ends mid-word. */
const shortName = (s: string, max: number) => (s.length <= max ? s : s.slice(0, max + 1).replace(/\s+\S*$/, '').replace(/[\s,&-]+$/, '') || s.slice(0, max))
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40)
const clamp = (n: unknown, lo: number, hi: number, d: number) => (typeof n === 'number' && isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : d)

/**
 * Turn an AI recipe into a valid Recipe for the editor. Ingredient ids are matched to the catalog
 * (by id, then by name); anything unknown becomes a new pantry item, created only if the recipe is saved.
 * Returns null if the reply can't make a usable recipe.
 */
export function normalizeDraft(raw: RawDraft, catalog: Catalog, takenIds: Set<string>): Draft | null {
  if (!raw || typeof raw.name !== 'string' || !raw.name.trim() || !Array.isArray(raw.tiers) || !raw.tiers.length) return null
  const newIngredients: Record<string, CustomIngredient> = {}
  const declared = new Map((raw.newIngredients ?? []).filter(n => n?.id && n.name).map(n => [n.id!, n]))
  const byName = new Map(Object.entries(catalog).map(([id, c]) => [c.name.toLowerCase(), id]))

  const resolve = (rawId: string | undefined): string | null => {
    if (!rawId || typeof rawId !== 'string') return null
    const id = rawId.trim()
    if (catalog[id]) return id
    const decl = declared.get(id)
    const name = (decl?.name ?? id.replace(/^new_/, '').replace(/_/g, ' ')).trim()
    const known = byName.get(name.toLowerCase()) ?? matchOrderItem(name, { skuMap: {} }, catalog)?.id
    if (known) return known
    const myId = `my_${slug(name)}`
    if (!slug(name)) return null
    newIngredients[myId] ??= {
      name: name.replace(/\b\w/g, c => c.toUpperCase()),
      cat: CATS.includes(decl?.cat ?? '') ? decl!.cat! : 'fresh',
      unit: decl?.unit === 'g' || decl?.unit === 'ml' || decl?.unit === 'pc' ? decl.unit : null
    }
    return myId
  }
  const unitOf = (id: string) => (catalog[id] ? catalog[id].unit : newIngredients[id]?.unit ?? null)

  const tiers = raw.tiers.slice(0, 4).map((t, i) => {
    const rows: IngRow[] = []
    for (const ing of t?.ingredients ?? []) {
      const id = resolve(ing?.id)
      if (!id || rows.some(r => r.id === id)) continue
      const sub = ing.substitute ? resolve(ing.substitute) : null
      const amount = unitOf(id) && typeof ing.amount === 'number' && ing.amount > 0 ? Math.round(ing.amount * 10) / 10 : null
      rows.push({ id, q: amount, opt: !!ing.optional, ...(sub && sub !== id ? { subId: sub, subQ: unitOf(sub) ? amount : null } : {}) })
    }
    return {
      name: shortName(typeof t?.name === 'string' && t.name.trim() ? t.name.trim() : ['Basic', 'Classic', 'Loaded', 'Special'][i], 32),
      mins: clamp(t?.mins, 1, 240, 20), effort: clamp(t?.effort, 1, 3, 1),
      add: rows.map(rowToSlot),
      steps: (t?.steps ?? []).filter((s): s is string => typeof s === 'string' && !!s.trim()).map(s => s.trim().slice(0, 240)).slice(0, 6)
    }
  }).filter(t => t.add.length)
  if (!tiers.length) return null

  const art: Art = {
    plate: (['steel', 'katori', 'ceramic', 'glass'] as const).find(p => p === raw.plate) ?? 'ceramic',
    fill: typeof raw.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(raw.color) ? raw.color : '#D9A35B',
    items: [['dice', 6, '#E8792B'], ['leaf', 4]]
  }
  const recipe: Recipe = {
    id: newRecipeId(raw.name, takenIds),
    name: raw.name.trim().slice(0, 70),
    meals: (raw.meals ?? []).filter((m): m is Meal => MEALS.includes(m as Meal)),
    tags: (raw.tags ?? []).filter((t): t is string => typeof t === 'string').map(t => t.toLowerCase().trim()).filter(Boolean).slice(0, 8),
    art, tiers, custom: true
  }
  if (!recipe.meals.length) recipe.meals = ['lunch', 'dinner']
  // Only keep new ingredients the final recipe actually uses.
  const used = new Set(tiers.flatMap(t => t.add.flatMap(s => s.replace('?', '').split('|').map(a => a.split(':')[0]))))
  for (const id of Object.keys(newIngredients)) if (!used.has(id)) delete newIngredients[id]
  if (!RecipeSchema.safeParse(recipe).success) return null
  return { recipe, why: typeof raw.why === 'string' ? raw.why.slice(0, 240) : '', newIngredients }
}

/** AI-understood filters for "I want". The engine still ranks whatever these select. */
export interface AiFilters { dishes?: string[]; tags?: string[]; ingredients?: string[]; maxMins?: number; meal?: string; energy?: string; summary?: string }

export function applyAiFilters(f: AiFilters, recipes: Recipe[], catalog: Catalog): Recipe[] {
  const names = new Set((f.dishes ?? []).map(d => String(d).toLowerCase()))
  if (names.size) {
    const hit = recipes.filter(r => names.has(r.name.toLowerCase()))
    if (hit.length) return hit
  }
  const tags = (f.tags ?? []).map(t => String(t).toLowerCase())
  const ings = (f.ingredients ?? []).filter(id => catalog[id])
  const uses = (r: Recipe, id: string) => r.tiers.some(t => t.add.some(s => s.replace('?', '').split('|').some(a => a.split(':')[0] === id)))
  const meal = MEALS.includes(f.meal as Meal) ? f.meal as Meal : null
  const max = typeof f.maxMins === 'number' && f.maxMins > 0 ? f.maxMins : null
  if (!tags.length && !ings.length && !meal && !max) return []
  return recipes.filter(r =>
    (!tags.length || tags.some(t => r.tags.includes(t))) &&
    (!ings.length || ings.some(id => uses(r, id))) &&
    (!meal || r.meals.includes(meal)) &&
    (!max || r.tiers[0].mins <= max))
}

/** A food item read from a photo. */
export interface ScanItem { name?: string; catalogId?: string; packs?: number; size?: number; unit?: string }
export interface ScanRow { key: string; name: string; id: string; amount: number | null; include: boolean; newUnit: 'pc' | 'g' | 'ml' | null }

/** Match scanned items to pantry items with amounts in each item's own unit. */
export function scanToRows(items: ScanItem[], kitchen: Pick<Kitchen, 'skuMap'>, catalog: Catalog): ScanRow[] {
  return items.filter(i => typeof i?.name === 'string' && i.name.trim()).map((it, k) => {
    const name = it.name!.trim()
    const id = it.catalogId && catalog[it.catalogId] ? it.catalogId : matchOrderItem(name, kitchen, catalog)?.id ?? ''
    const unit = id ? catalog[id].unit : null
    const packs = typeof it.packs === 'number' && it.packs > 0 ? it.packs : 1
    // packs × size-per-pack, multiplied here rather than trusting the model's arithmetic
    const size = it.unit === unit && typeof it.size === 'number' && it.size > 0 ? it.size : null
    let amount: number | null = null
    if (id && unit === 'pc') amount = packs * (size ?? 1)
    else if (id && unit) amount = packs * (size ?? packAmount(id, name, catalog) ?? 1)
    const newUnit = it.unit === 'pc' || it.unit === 'g' || it.unit === 'ml' ? it.unit : null
    return { key: `scan${k}`, name, id, amount: amount != null ? Math.round(amount * 10) / 10 : null, include: !!id, newUnit }
  })
}
