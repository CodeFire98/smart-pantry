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
  sku: Sku | null
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
}

/** One pantry entry: `q` for quantity-tracked items, `l` (0-3) for level-tracked ones. */
export interface PantryItem {
  q?: number
  l?: number
  /** ISO date (YYYY-MM-DD) the item is expected to go off. */
  exp?: string
  unsure?: boolean
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

export interface Kitchen {
  items: Record<string, PantryItem>
  equipment: string[]
  /** Shopping list: ingredient ids, in the order they were added. */
  list: string[]
  skuMap?: Record<string, SkuPick>
  pendingOrders?: PendingOrder[]
  /** Instamart order ids already added to the pantry. */
  importedOrders?: string[]
}

export interface JournalEntry {
  id?: number
  recipeId: string
  recipeName: string
  tier: string
  tierIndex: number
  rating: number | null
  note: string
  photoId?: number
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
