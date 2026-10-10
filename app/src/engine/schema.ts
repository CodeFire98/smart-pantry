import { z } from 'zod'

const hex = z.string().regex(/^#[0-9a-fA-F]{3,8}$/)
const slot = z.string().regex(/^\??[a-z0-9_]+(:\d+(\.\d+)?)?(\|[a-z0-9_]+(:\d+(\.\d+)?)?)*$/, 'bad ingredient slot')
const unit = z.enum(['pc', 'g', 'ml']).nullable()

export const IngredientSchema = z.object({
  name: z.string().min(1),
  cat: z.string(),
  unit,
  kind: z.enum(['per', 'dur', 'stp']),
  shelf: z.number().min(0),
  aliases: z.array(z.string()).optional(),
  sku: z.object({ name: z.string(), pack: z.number().positive(), price: z.number().min(0) }).nullable()
})
export const CatalogSchema = z.record(IngredientSchema)

export const RecipeSchema = z.object({
  id: z.string().regex(/^[a-z0-9_]+$/),
  name: z.string().min(1).max(80),
  aliases: z.array(z.string()).optional(),
  meals: z.array(z.enum(['breakfast', 'lunch', 'snack', 'dinner'])).min(1),
  tags: z.array(z.string()),
  why: z.string().optional(),
  custom: z.boolean().optional(),
  art: z.object({
    plate: z.enum(['steel', 'katori', 'ceramic', 'glass']),
    fill: hex,
    items: z.array(z.union([z.tuple([z.string(), z.number()]), z.tuple([z.string(), z.number(), hex])]))
  }).optional(),
  newIngredients: z.record(z.object({ name: z.string(), unit, cat: z.string() })).optional(),
  tiers: z.array(z.object({
    name: z.string().min(1),
    mins: z.number().positive(),
    effort: z.number().int().min(1).max(3),
    add: z.array(slot).min(1),
    steps: z.array(z.string()),
    needs: z.array(z.string()).optional()
  })).min(1)
})
export const RecipeFileSchema = z.object({ version: z.number(), recipes: z.array(RecipeSchema) })

export const PantrySeedSchema = z.object({
  asOf: z.string(),
  household: z.number(),
  equipment: z.array(z.string()),
  items: z.record(z.object({
    q: z.number().min(0).optional(),
    l: z.number().int().min(0).max(3).optional(),
    exp: z.number().optional(),
    unsure: z.boolean().optional()
  }))
})

/** Ingredient ids a recipe references (all alternatives, optional or not). */
export function slotIds(slots: string[]): string[] {
  return slots.flatMap(s => s.replace('?', '').split('|').map(a => a.split(':')[0]))
}
