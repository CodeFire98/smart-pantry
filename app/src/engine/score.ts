import { ENERGY, cookable, equipMissing, fits, have, missing, tierSlots } from './availability'
import { daysBetween, DAY_MS } from './dates'
import { taste as computeTaste, type Taste } from './taste'
import type { Context, Recipe } from './types'

export interface Term { label: string; points: number; expiring?: boolean }

export interface Evaluation {
  recipe: Recipe
  score: number
  terms: Term[]
  /** Highest tier that is fully stocked and fits the energy level, or -1. */
  cook: number
  /** Highest tier that fits the energy level (and equipment), or -1. */
  target: number
  /** Present when a richer tier within energy is a few items away. */
  upgrade: { tier: number; missing: string[] } | null
  group: 'now' | 'away' | 'out'
  /** For 'away': what the simplest tier is missing. */
  need: string[]
}

/**
 * Score one recipe. Weights follow PRD §6.4 and §9:
 * meal +30, energy fit +20, tier depth up to +10, uses an item expiring within 2 days +15,
 * mood +10 each, chicken without the chicken mood −10, own rating (avg−3)×6, liked tags +5 each (max 2),
 * missing for target tier −8 each, nothing fits energy −20, cooked in the last 2 days −20.
 */
export function evaluate(r: Recipe, ctx: Context, t: Taste = computeTaste(ctx.journal, [r])): Evaluation {
  const { kitchen, catalog, energy } = ctx
  const terms: Term[] = []
  const en = ENERGY[energy].name.toLowerCase()
  const fitIdx = r.tiers.map((tier, i) => (fits(tier, energy) && !equipMissing(r, i, kitchen).length ? i : -1)).filter(i => i >= 0)
  const target = fitIdx.length ? Math.max(...fitIdx) : -1
  const cookFit = fitIdx.filter(i => cookable(r, i, kitchen, catalog))
  const cook = cookFit.length ? Math.max(...cookFit) : -1

  if (r.meals.includes(ctx.meal)) terms.push({ label: `Suits ${ctx.meal}`, points: 30 })
  if (cook >= 0) {
    terms.push({ label: `${r.tiers[cook].name} fits ${en} energy`, points: 20 })
    terms.push({ label: `Can make version ${cook + 1} of ${r.tiers.length}`, points: Math.round((10 * (cook + 1)) / r.tiers.length) })
  }

  const used = tierSlots(r, cook >= 0 ? cook : Math.max(target, 0)).map(sl => have(sl, kitchen, catalog)).filter(h => h.ok)
  const daysLeft = (id: string) => { const e = kitchen.items[id]?.exp; return e ? daysBetween(ctx.today, e) : null }
  const expiring = used.map(h => ({ id: h.id!, d: daysLeft(h.id!) })).filter(x => x.d != null && x.d <= 2).sort((a, b) => a.d! - b.d!)
  if (expiring.length) {
    const { id, d } = expiring[0]
    const when = d! <= 0 ? 'use today' : d === 1 ? 'expires tomorrow' : '2 days left'
    terms.push({ label: `Uses ${catalog[id].name.toLowerCase()} (${when})`, points: 15, expiring: true })
  }

  for (const m of ctx.moods) if (r.tags.includes(m)) terms.push({ label: `Matches “${m}”`, points: 10 })
  if (r.tags.includes('chicken') && !ctx.moods.includes('chicken')) terms.push({ label: 'Chicken is an occasional pick for you', points: -10 })

  const pr = t.recipe[r.id]
  if (pr) terms.push({ label: `You rated it ${pr.avg.toFixed(1)}★ (${pr.n}×)`, points: Math.round((pr.avg - 3) * 6) })
  const liked = r.tags.filter(tag => t.liked.includes(tag))
  if (liked.length) terms.push({ label: `You enjoy ${liked.slice(0, 2).join(' & ')} dishes`, points: 5 * Math.min(liked.length, 2) })

  let upgrade: Evaluation['upgrade'] = null
  if (target < 0) terms.push({ label: `Even the simplest version is too much for ${en} energy`, points: -20 })
  else {
    const miss = missing(r, target, kitchen, catalog)
    if (miss.length) {
      terms.push({ label: `${miss.length} missing for ${r.tiers[target].name}`, points: -8 * miss.length })
      if (cook >= 0 && target > cook) upgrade = { tier: target, missing: miss }
    }
  }

  const last = ctx.journal.filter(j => j.recipeId === r.id).reduce((a, j) => Math.max(a, j.at), 0)
  if (last && ctx.now - last < 2 * DAY_MS) terms.push({ label: 'Cooked in the last 2 days', points: -20 })

  const unsure = used.filter(h => h.unsure).map(h => catalog[h.id!].name.toLowerCase())
  if (unsure.length) terms.push({ label: `Assumes you still have ${unsure.join(', ')}`, points: 0 })

  const score = terms.reduce((a, b) => a + b.points, 0)
  let group: Evaluation['group'] = 'out', need: string[] = []
  if (cook >= 0) group = 'now'
  else if (target >= 0) {
    const m0 = missing(r, 0, kitchen, catalog)
    if (m0.length > 0 && m0.length <= 2) { group = 'away'; need = m0 }
  }
  return { recipe: r, score, terms, cook, target, upgrade, group, need }
}

/** Rank recipes: score descending, then name, so ties are stable. */
export function rank(recipes: Recipe[], ctx: Context): Evaluation[] {
  const t = computeTaste(ctx.journal, recipes)
  return recipes.map(r => evaluate(r, ctx, t)).sort((a, b) => b.score - a.score || a.recipe.name.localeCompare(b.recipe.name))
}
