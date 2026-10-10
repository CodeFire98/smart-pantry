import Dexie, { type Table } from 'dexie'
import { CATALOG, RECIPES, RecipeSchema, deduct, isoDate, kitchenFromSeed, type Catalog, type JournalEntry, type Kitchen, type Recipe } from '../engine'

interface KV { key: string; value: unknown }
export interface Photo { id?: number; blob: Blob; at: number }

class PantryDB extends Dexie {
  kv!: Table<KV, string>
  journal!: Table<JournalEntry, number>
  photos!: Table<Photo, number>
  recipes!: Table<Recipe, string>
  constructor() {
    super('smart-pantry')
    this.version(1).stores({ kv: 'key', journal: '++id, recipeId, at', photos: '++id', recipes: 'id' })
  }
}

export const db = new PantryDB()

let persistAsked = false
function askPersist() {
  if (persistAsked) return
  persistAsked = true
  navigator.storage?.persist?.().catch(() => {})
}

/** First run: seed the kitchen from data/pantry.json. Safe to call repeatedly. */
export async function ensureKitchen(): Promise<void> {
  await db.transaction('rw', db.kv, async () => {
    if (!(await db.kv.get('kitchen'))) await db.kv.put({ key: 'kitchen', value: kitchenFromSeed(isoDate()) })
  })
}

export async function updateKitchen(fn: (k: Kitchen) => Kitchen): Promise<void> {
  await db.transaction('rw', db.kv, async () => {
    const cur = ((await db.kv.get('kitchen'))?.value as Kitchen | undefined) ?? kitchenFromSeed(isoDate())
    await db.kv.put({ key: 'kitchen', value: fn(structuredClone(cur)) })
  })
  askPersist()
}

export async function resetKitchen(): Promise<void> {
  await db.kv.put({ key: 'kitchen', value: kitchenFromSeed(isoDate()) })
}

/** Recipes from data/ plus ones you added; custom ingredients extend the catalog. */
export function catalogWith(custom: Recipe[]): Catalog {
  const cat: Catalog = { ...CATALOG }
  for (const r of custom) for (const [id, v] of Object.entries(r.newIngredients ?? {})) {
    cat[id] ??= { name: v.name, cat: v.cat, unit: v.unit, kind: ['spices', 'sauces'].includes(v.cat) ? 'stp' : 'per', shelf: 5, sku: null }
  }
  return cat
}
export const allRecipes = (custom: Recipe[]) => [...RECIPES, ...custom.filter(c => !RECIPES.some(r => r.id === c.id))]

export interface CookLog { recipe: Recipe; tierIndex: number; rating: number | null; note: string; photo: Blob | null; catalog: Catalog }

/** Log a cook: store the photo, deduct the pantry and add the journal entry in one transaction. */
export async function logCook({ recipe, tierIndex, rating, note, photo, catalog }: CookLog) {
  let used: ReturnType<typeof deduct>['used'] = []
  await db.transaction('rw', db.kv, db.journal, db.photos, async () => {
    const photoId = photo ? await db.photos.add({ blob: photo, at: Date.now() }) : undefined
    const cur = ((await db.kv.get('kitchen'))?.value as Kitchen | undefined) ?? kitchenFromSeed(isoDate())
    const out = deduct(recipe, tierIndex, cur, catalog)
    used = out.used
    await db.kv.put({ key: 'kitchen', value: out.kitchen })
    await db.journal.add({
      recipeId: recipe.id, recipeName: recipe.name, tier: recipe.tiers[tierIndex].name, tierIndex,
      rating, note, at: Date.now(), ...(photoId != null ? { photoId } : {})
    })
  })
  askPersist()
  return used
}

/** Validate and store a recipe (e.g. one drafted by the prototype's AI button). Returns the problem, if any. */
export async function importRecipes(json: unknown): Promise<{ added: string[]; error?: string }> {
  const list = Array.isArray(json) ? json : (json as { recipes?: unknown[] })?.recipes ?? [json]
  const added: string[] = []
  for (const raw of list) {
    const parsed = RecipeSchema.safeParse(raw)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      return { added, error: `${issue.path.join('.') || 'recipe'}: ${issue.message}` }
    }
    const r = { ...(parsed.data as Recipe), custom: true }
    if (RECIPES.some(x => x.id === r.id)) r.id = `my_${r.id}`
    await db.recipes.put(r)
    added.push(r.name)
  }
  return { added }
}

export interface Backup { app: 'smart-pantry'; version: 1; exportedAt: string; kitchen: Kitchen; journal: JournalEntry[]; recipes: Recipe[] }

export async function exportBackup(): Promise<Backup> {
  return {
    app: 'smart-pantry', version: 1, exportedAt: new Date().toISOString(),
    kitchen: (await db.kv.get('kitchen'))?.value as Kitchen,
    journal: (await db.journal.toArray()).map(({ photoId: _p, ...j }) => j),
    recipes: await db.recipes.toArray()
  }
}

export async function importBackup(b: Backup): Promise<void> {
  if (b?.app !== 'smart-pantry' || !b.kitchen?.items) throw new Error('This file is not a Smart Pantry backup.')
  await db.transaction('rw', db.kv, db.journal, db.recipes, async () => {
    await db.kv.put({ key: 'kitchen', value: { ...b.kitchen, list: b.kitchen.list ?? [] } })
    await db.journal.clear()
    await db.journal.bulkAdd(b.journal.map(({ id: _id, ...j }) => j))
    await db.recipes.clear()
    await db.recipes.bulkPut(b.recipes)
  })
}
