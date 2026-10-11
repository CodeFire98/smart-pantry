export type Unit = 'pc' | 'g' | 'ml' | null
export type Kind = 'per' | 'dur' | 'stp'
export type Meal = 'breakfast' | 'lunch' | 'snack' | 'dinner'
export type Energy = 1 | 2 | 3

export interface Sku {
  name: string
  pack: number
  price: number
}

export interface Ingredient {
  name: string
  cat: string
  unit: Unit
  kind: Kind
  shelf: number
  /** Other names shops use (Hindi names, product types), for matching Instamart order lines. */
  aliases?: string[]
  /** How much one +/− tap changes the amount in the Pantry. Defaults to the pack size. */
  step?: number
  /** Hidden from the Pantry list (still usable by recipes). */
  hidden?: boolean
  sku: Sku | null
}

/** Your changes to a built-in ingredient (name, section, pack size, hidden). */
export interface IngredientEdit {
  name?: string
  cat?: string
  pack?: number
  hidden?: boolean
}

export type Catalog = Record<string, Ingredient>

export type ArtItem = [string, number] | [string, number, string]

export interface Art {
  plate: 'steel' | 'katori' | 'ceramic' | 'glass'
  fill: string
  items: ArtItem[]
}

export interface Tier {
  name: string
  mins: number
  effort: number
  add: string[]
  steps: string[]
  needs?: string[]
}

export interface NewIngredient {
  name: string
  unit: Unit
  cat: string
}

export interface Recipe {
  id: string
  name: string
  aliases?: string[]
  meals: Meal[]
  tags: string[]
  art?: Art
  tiers: Tier[]
  why?: string
  custom?: boolean
  newIngredients?: Record<string, NewIngredient>
  updatedAt?: number
}

/** One pantry entry: `q` for quantity-tracked items, `l` (0-3) for level-tracked ones. */
export interface PantryItem {
  q?: number
  l?: number
  /** ISO date (YYYY-MM-DD) the item is expected to go off. */
  exp?: string
  unsure?: boolean
  /** Last edited (ms), for syncing between devices. */
  t?: number
}

/** An Instamart product you picked for an ingredient (remembered for next time). */
export interface SkuPick {
  spinId: string
  skuId: string
  name: string
  quantityDescription: string
  price: number
  imageUrl: string | null
  /** How many packs to order. */
  qty: number
}

/** An order placed from the app, kept until it's delivered and added to the pantry. */
export interface PendingOrder {
  orderId: string
  at: number
  total: number
  lines: { id: string; packs: number; quantityDescription: string }[]
}

/** A pantry item you added yourself (not in data/ingredients.json). */
export interface CustomIngredient {
  name: string
  cat: string
  unit: Unit
  /** Pack size in `unit`, used for +/− steps and restocks. */
  pack?: number
}

export interface Kitchen {
  items: Record<string, PantryItem>
  equipment: string[]
  /** Shopping list: ingredient ids, in the order they were added. */
  list: string[]
  skuMap?: Record<string, SkuPick>
  pendingOrders?: PendingOrder[]
  /** Instamart order ids already added to the pantry. */
  importedOrders?: string[]
  customIngredients?: Record<string, CustomIngredient>
  ingredientEdits?: Record<string, IngredientEdit>
  /** Last edited (ms) per top-level field, for syncing between devices. */
  fieldT?: Record<string, number>
  /** Deleted pantry items: id → when (ms), so a deletion syncs instead of coming back. */
  tombstones?: Record<string, number>
}

export interface JournalEntry {
  id?: number
  /** Stable id across devices. */
  uid?: string
  updatedAt?: number
  recipeId: string
  recipeName: string
  tier: string
  tierIndex: number
  rating: number | null
  note: string
  photoId?: number
  /** Server key of the photo (synced); photoId is this device's local copy. */
  photo?: string
  /** Soft delete, so deletions sync. */
  deletedAt?: number
  at: number
}

/** Everything a ranking depends on. Passing `today` and `now` in keeps the engine deterministic. */
export interface Context {
  catalog: Catalog
  kitchen: Kitchen
  journal: JournalEntry[]
  meal: Meal
  energy: Energy
  moods: string[]
  today: string
  now: number
}
