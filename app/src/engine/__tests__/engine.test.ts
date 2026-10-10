import { describe, expect, it } from 'vitest'
import {
  CATALOG, PANTRY_SEED, RECIPES, cookable, deduct, evaluate, have, interpret, kitchenFromSeed, parseSlot, rank,
  restock, slotIds, taste, type Context, type JournalEntry, type Kitchen
} from '..'

const TODAY = '2026-10-10'
const NOW = new Date(2026, 9, 10, 13).getTime()
const recipe = (id: string) => RECIPES.find(r => r.id === id)!
const ctx = (over: Partial<Context> = {}): Context => ({
  catalog: CATALOG, kitchen: kitchenFromSeed(TODAY), journal: [], meal: 'lunch', energy: 2, moods: [], today: TODAY, now: NOW, ...over
})
const withItems = (k: Kitchen, items: Kitchen['items']): Kitchen => ({ ...k, items: { ...k.items, ...items } })

describe('seed data', () => {
  it('every recipe and pantry ingredient exists in the catalog', () => {
    const unknown = RECIPES.flatMap(r => r.tiers.flatMap(t => slotIds(t.add))).filter(id => !CATALOG[id])
    expect(unknown).toEqual([])
    expect(Object.keys(PANTRY_SEED.items).filter(id => !CATALOG[id])).toEqual([])
  })
  it('has 20 recipes with 3 tiers each and unique ids', () => {
    expect(RECIPES).toHaveLength(20)
    expect(new Set(RECIPES.map(r => r.id)).size).toBe(20)
    expect(RECIPES.every(r => r.tiers.length === 3)).toBe(true)
  })
  it('turns relative expiry days into dates', () => {
    const k = kitchenFromSeed(TODAY)
    expect(k.items.milk).toEqual({ q: 500, exp: '2026-10-12' })
    expect(k.items.green_chilli.unsure).toBe(true)
  })
})

describe('slots and availability', () => {
  it('parses optional, quantity and substitute slots', () => {
    expect(parseSlot('?capsicum:1')).toEqual({ opt: true, alts: [{ id: 'capsicum', q: 1 }], main: 'capsicum', need: 1 })
    expect(parseSlot('milk:50|cream:50').alts.map(a => a.id)).toEqual(['milk', 'cream'])
  })
  it('checks quantities against what the recipe needs', () => {
    const k = kitchenFromSeed(TODAY)
    expect(have(parseSlot('eggs:2'), k, CATALOG)).toMatchObject({ ok: true, q: 2 })
    expect(have(parseSlot('eggs:2'), withItems(k, { eggs: { q: 1 } }), CATALOG)).toMatchObject({ ok: true, low: true, q: 1, need: 2 })
    expect(have(parseSlot('eggs:2'), withItems(k, { eggs: { q: 0 } }), CATALOG).ok).toBe(false)
  })
  it('falls back to a substitute', () => {
    const k = withItems(kitchenFromSeed(TODAY), { butter: { q: 0 } })
    expect(have(parseSlot('butter:10|oil'), k, CATALOG)).toMatchObject({ ok: true, id: 'oil', sub: true })
  })
  it('flags unsure items but still counts them', () => {
    expect(have(parseSlot('green_chilli'), kitchenFromSeed(TODAY), CATALOG)).toMatchObject({ ok: true, unsure: true })
  })
  it('optional ingredients never block a tier', () => {
    // Egg fried rice "Loaded" lists capsicum as optional; there is no capsicum in the seed pantry.
    expect(cookable(recipe('egg_fried_rice'), 2, kitchenFromSeed(TODAY), CATALOG)).toBe(true)
  })
  it('equipment gates a tier', () => {
    const shake = recipe('pb_banana'), k = kitchenFromSeed(TODAY)
    expect(cookable(shake, 2, k, CATALOG)).toBe(false)
    expect(cookable(shake, 2, { ...k, equipment: [...k.equipment, 'blender'] }, CATALOG)).toBe(true)
  })
})

describe('ranking', () => {
  it('is deterministic', () => {
    expect(rank(RECIPES, ctx()).map(e => e.recipe.id)).toEqual(rank(RECIPES, ctx()).map(e => e.recipe.id))
  })
  it('golden: lunch at medium energy on the starting pantry', () => {
    const r = rank(RECIPES, ctx())
    expect(r.slice(0, 3).map(e => e.recipe.id)).toEqual(['potato_soup', 'paneer_skillet', 'egg_fried_rice'])
    expect(r[0].terms.map(t => t.label)).toContain('Uses milk (2 days left)')
    expect(r.filter(e => e.group === 'now')).toHaveLength(16)
  })
  it('never offers chicken dishes as cook-now without chicken, and down-ranks them', () => {
    const r = rank(RECIPES, ctx())
    const chicken = r.filter(e => e.recipe.tags.includes('chicken'))
    expect(chicken.every(e => e.group !== 'now')).toBe(true)
    expect(chicken.every(e => e.terms.some(t => t.points === -10))).toBe(true)
  })
  it('low energy picks quicker versions and drops long dishes', () => {
    const r = rank(RECIPES, ctx({ meal: 'dinner', energy: 1 }))
    expect(r[0].recipe.id).toBe('paneer_skillet')
    const curry = r.find(e => e.recipe.id === 'chicken_curry')!
    expect(curry.target).toBe(-1)
    expect(curry.group).toBe('out')
  })
  it('suggests the one-item upgrade', () => {
    const e = evaluate(recipe('chilli_paneer'), ctx({ meal: 'dinner' }))
    expect(e.cook).toBe(0)
    expect(e.upgrade).toEqual({ tier: 2, missing: ['capsicum', 'cornflour'] })
  })
  it('learns from ratings and recent cooks', () => {
    const j = (rating: number, at: number): JournalEntry => ({ recipeId: 'chilli_paneer', recipeName: 'Chilli Paneer', tier: 'Dry', tierIndex: 1, rating, note: '', at })
    const old = NOW - 5 * 86_400_000
    const liked = evaluate(recipe('chilli_paneer'), ctx({ meal: 'dinner', journal: [j(5, old), j(5, old)] }), taste([j(5, old), j(5, old)], RECIPES))
    const base = evaluate(recipe('chilli_paneer'), ctx({ meal: 'dinner' }))
    expect(liked.score - base.score).toBe(12 + 10)
    const recent = evaluate(recipe('chilli_paneer'), ctx({ meal: 'dinner', journal: [j(5, NOW - 3_600_000)] }))
    expect(recent.terms.map(t => t.label)).toContain('Cooked in the last 2 days')
  })
})

describe('pantry updates', () => {
  it('cooking deducts exact quantities and leaves staples alone', () => {
    const k = kitchenFromSeed(TODAY)
    const { kitchen, used } = deduct(recipe('egg_fried_rice'), 2, k, CATALOG)
    expect(kitchen.items.eggs.q).toBe(4)
    expect(kitchen.items.rice.q).toBe(1920)
    expect(kitchen.items.onion.q).toBe(4)
    expect(kitchen.items.peas.q).toBe(360)
    expect(kitchen.items.soy_sauce).toEqual(k.items.soy_sauce)
    expect(used.map(u => u.id)).toEqual(['rice', 'eggs', 'onion', 'carrot', 'peas'])
    expect(k.items.eggs.q).toBe(6)
  })
  it('takes only what is left when short', () => {
    const k = withItems(kitchenFromSeed(TODAY), { eggs: { q: 1 } })
    expect(deduct(recipe('omelette_toast'), 0, k, CATALOG).kitchen.items.eggs.q).toBe(0)
  })
  it('restocking adds a pack, sets expiry and clears the list', () => {
    const k = { ...kitchenFromSeed(TODAY), list: ['capsicum', 'chicken'] }
    const out = restock(['capsicum'], k, CATALOG, TODAY)
    expect(out.items.capsicum).toEqual({ q: 2, exp: '2026-10-16' })
    expect(out.list).toEqual(['chicken'])
  })
})

describe('interpret', () => {
  it('matches dish names and aliases', () => {
    expect(interpret('dal', RECIPES, CATALOG)!.dishes.map(r => r.id)).toEqual(['moong_dal_tadka'])
  })
  it('matches ingredients and moods', () => {
    const it = interpret('something spicy with paneer', RECIPES, CATALOG)!
    expect(it.tags).toEqual(['spicy'])
    expect(it.ingredients).toContain('paneer')
    expect(it.results.map(r => r.id)).toEqual(['chilli_paneer'])
  })
  it('returns no results for unknown text', () => {
    expect(interpret('rajma chawal', RECIPES, CATALOG)!.results).toEqual([])
  })
})
