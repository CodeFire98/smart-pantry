import ingredientsJson from '@data/ingredients.json'
import recipesJson from '@data/recipes.json'
import pantryJson from '@data/pantry.json'
import { CatalogSchema, PantrySeedSchema, RecipeFileSchema } from './schema'
import { addDays } from './dates'
import type { Catalog, Kitchen, Recipe } from './types'

const { _doc: _ignored, ...rawCatalog } = ingredientsJson as Record<string, unknown>

export const CATALOG: Catalog = CatalogSchema.parse(rawCatalog) as Catalog
export const RECIPES: Recipe[] = RecipeFileSchema.parse(recipesJson).recipes as Recipe[]
export const PANTRY_SEED = PantrySeedSchema.parse(pantryJson)

/** Starting kitchen from data/pantry.json, with relative expiry days turned into dates from `today`. */
export function kitchenFromSeed(today: string, seed = PANTRY_SEED): Kitchen {
  const items: Kitchen['items'] = {}
  for (const [id, v] of Object.entries(seed.items)) {
    items[id] = {
      ...(v.q != null ? { q: v.q } : { l: v.l ?? 3 }),
      ...(v.exp != null ? { exp: addDays(today, v.exp) } : {}),
      ...(v.unsure ? { unsure: true } : {})
    }
  }
  return { items, equipment: [...seed.equipment], list: [] }
}
