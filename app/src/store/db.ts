import Dexie, { type Table } from 'dexie'
import { CATALOG, RECIPES, RecipeSchema, deduct, isoDate, kitchenFromSeed, stampKitchen, type Catalog, type JournalEntry, type Kitchen, type Recipe } from '../engine'
import { notifyChange } from './changes'

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
    // v2: stable ids + edit times on journal entries (for editing now, syncing later)
    this.version(2).stores({ journal: '++id, recipeId, at, &uid' }).upgrade(tx =>
      tx.table('journal').toCollection().modify((j: JournalEntry) => { j.uid ??= crypto.randomUUID(); j.updatedAt ??= j.at }))
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

const readKitchen = async () => ((await db.kv.get('kitchen'))?.value as Kitchen | undefined) ?? kitchenFromSeed(isoDate())

/** Change the kitchen. Edits are time-stamped (per item / per field) so they sync correctly between devices. */
export async function updateKitchen(fn: (k: Kitchen) => Kitchen): Promise<void> {
  await db.transaction('rw', db.kv, async () => {
    const cur = await readKitchen()
    await db.kv.put({ key: 'kitchen', value: stampKitchen(cur, fn(structuredClone(cur)), Date.now()) })
  })
  askPersist()
  notifyChange()
}

/** Replace the kitchen with an already-merged copy from sync (no new timestamps). */
export async function putSyncedKitchen(k: Kitchen) {
  await db.kv.put({ key: 'kitchen', value: k })
}
export { readKitchen }

/** Back to the starting pantry amounts. Keeps what you set up: your own items, product picks and orders. */
export async function resetKitchen(): Promise<void> {
  await updateKitchen(k => {
    const fresh = kitchenFromSeed(isoDate())
    const custom = Object.fromEntries(Object.entries(k.customIngredients ?? {}).map(([id, v]) => [id, v.unit ? { q: 0 } : { l: 0 }]))
    return { ...fresh, items: { ...custom, ...fresh.items }, customIngredients: k.customIngredients, skuMap: k.skuMap, pendingOrders: k.pendingOrders, importedOrders: k.importedOrders }
  })
}

/** Built-in catalog + pantry items you added + ingredients introduced by recipes you imported. */
export function catalogWith(custom: Recipe[], kitchen?: Kitchen): Catalog {
  const cat: Catalog = { ...CATALOG }
  for (const [id, v] of Object.entries(kitchen?.customIngredients ?? {})) {
    cat[id] ??= { name: v.name, cat: v.cat, unit: v.unit, kind: ['spices', 'sauces'].includes(v.cat) ? 'stp' : 'dur', shelf: 0, ...(v.pack ? { step: v.unit === 'pc' ? 1 : v.pack } : {}), sku: v.pack ? { name: v.name, pack: v.pack, price: 0 } : null }
  }
  for (const r of custom) for (const [id, v] of Object.entries(r.newIngredients ?? {})) {
    cat[id] ??= { name: v.name, cat: v.cat, unit: v.unit, kind: ['spices', 'sauces'].includes(v.cat) ? 'stp' : 'per', shelf: 5, sku: null }
  }
  return cat
}

/** Edit a journal entry (version, rating, note). The pantry is not re-deducted. */
export async function updateJournal(id: number, patch: Partial<Pick<JournalEntry, 'tier' | 'tierIndex' | 'rating' | 'note'>>) {
  await db.journal.update(id, { ...patch, updatedAt: Date.now() })
  notifyChange()
}

/** Add, replace or remove the photo on a journal entry. */
export async function setJournalPhoto(id: number, photo: Blob | null) {
  await db.transaction('rw', db.journal, db.photos, async () => {
    const j = await db.journal.get(id)
    if (!j) return
    if (j.photoId != null) await db.photos.delete(j.photoId)
    const photoId = photo ? await db.photos.add({ blob: photo, at: Date.now() }) : undefined
    // Each photo version gets a new server key, so other devices fetch the new one.
    await db.journal.update(id, { photoId, photo: photo ? `${j.uid}-${Date.now()}` : undefined, updatedAt: Date.now() })
  })
  askPersist()
  notifyChange()
}

/** Soft delete (kept as a tombstone so the deletion syncs to your other devices). */
export async function deleteJournal(id: number) {
  await db.transaction('rw', db.journal, db.photos, async () => {
    const j = await db.journal.get(id)
    if (j?.photoId != null) await db.photos.delete(j.photoId)
    await db.journal.update(id, { deletedAt: Date.now(), updatedAt: Date.now(), photoId: undefined, photo: undefined, note: '' })
  })
  notifyChange()
}
export const allRecipes = (custom: Recipe[]) => [...RECIPES, ...custom.filter(c => !RECIPES.some(r => r.id === c.id))]

export interface CookLog { recipe: Recipe; tierIndex: number; rating: number | null; note: string; photo: Blob | null; catalog: Catalog }

/** Log a cook: store the photo, deduct the pantry and add the journal entry in one transaction. */
export async function logCook({ recipe, tierIndex, rating, note, photo, catalog }: CookLog) {
  let used: ReturnType<typeof deduct>['used'] = []
  await db.transaction('rw', db.kv, db.journal, db.photos, async () => {
    const photoId = photo ? await db.photos.add({ blob: photo, at: Date.now() }) : undefined
    const cur = await readKitchen()
    const out = deduct(recipe, tierIndex, cur, catalog)
    used = out.used
    const now = Date.now(), uid = crypto.randomUUID()
    await db.kv.put({ key: 'kitchen', value: stampKitchen(cur, out.kitchen, now) })
    await db.journal.add({
      recipeId: recipe.id, recipeName: recipe.name, tier: recipe.tiers[tierIndex].name, tierIndex,
      rating, note, at: now, uid, updatedAt: now, ...(photoId != null ? { photoId, photo: `${uid}-${now}` } : {})
    })
  })
  askPersist()
  notifyChange()
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
    const r = { ...(parsed.data as Recipe), custom: true, updatedAt: Date.now() }
    if (RECIPES.some(x => x.id === r.id)) r.id = `my_${r.id}`
    await db.recipes.put(r)
    added.push(r.name)
  }
  if (added.length) notifyChange()
  return { added }
}

export interface Backup { app: 'smart-pantry'; version: 1; exportedAt: string; kitchen: Kitchen; journal: JournalEntry[]; recipes: Recipe[] }

export async function exportBackup(): Promise<Backup> {
  return {
    app: 'smart-pantry', version: 1, exportedAt: new Date().toISOString(),
    kitchen: (await db.kv.get('kitchen'))?.value as Kitchen,
    journal: (await db.journal.toArray()).filter(j => !j.deletedAt).map(({ photoId: _p, ...j }) => j),
    recipes: await db.recipes.toArray()
  }
}

export async function importBackup(b: Backup): Promise<void> {
  if (b?.app !== 'smart-pantry' || !b.kitchen?.items) throw new Error('This file is not a Smart Pantry backup.')
  await db.transaction('rw', db.kv, db.journal, db.recipes, async () => {
    // A restore counts as a fresh edit of everything, so it wins over older copies on other devices.
    await db.kv.put({ key: 'kitchen', value: stampKitchen(undefined, { ...b.kitchen, list: b.kitchen.list ?? [] }, Date.now()) })
    await db.journal.clear()
    await db.journal.bulkAdd(b.journal.map(({ id: _id, ...j }) => ({ ...j, uid: j.uid ?? crypto.randomUUID(), updatedAt: j.updatedAt ?? j.at })))
    await db.recipes.clear()
    await db.recipes.bulkPut(b.recipes)
  })
  notifyChange()
}
