import { describe, expect, it } from 'vitest'
import { RECIPES, newRecipeId, resolveRecipes, rowToSlot, slotToRow } from '..'

describe('slot ↔ editor row', () => {
  it('round-trips every slot in all 20 built-in recipes', () => {
    const slots = RECIPES.flatMap(r => r.tiers.flatMap(t => t.add))
    expect(slots.length).toBeGreaterThan(150)
    for (const s of slots) expect(rowToSlot(slotToRow(s))).toBe(s)
  })
  it('parses optional, amount and substitute', () => {
    expect(slotToRow('?capsicum:1')).toEqual({ id: 'capsicum', q: 1, opt: true })
    expect(slotToRow('milk:50|cream:50')).toEqual({ id: 'milk', q: 50, opt: false, subId: 'cream', subQ: 50 })
    expect(rowToSlot({ id: 'butter', q: 10, opt: false, subId: 'oil', subQ: null })).toBe('butter:10|oil')
  })
})

describe('resolveRecipes', () => {
  const poha = RECIPES.find(r => r.id === 'tomato_bath')!
  it('uses built-ins as they are with no records', () => {
    expect(resolveRecipes(RECIPES, []).recipes).toHaveLength(20)
  })
  it('an edited built-in replaces the original', () => {
    const r = resolveRecipes(RECIPES, [{ ...poha, name: 'My Poha', updatedAt: 5 }])
    expect(r.recipes.find(x => x.id === 'tomato_bath')!.name).toBe('My Poha')
    expect(r.edited.has('tomato_bath')).toBe(true)
    expect(r.recipes).toHaveLength(20)
  })
  it('hides and restores', () => {
    const hidden = resolveRecipes(RECIPES, [{ id: 'chicken_pulao', hidden: true, updatedAt: 1 }])
    expect(hidden.recipes.map(x => x.id)).not.toContain('chicken_pulao')
    expect(hidden.hidden.map(x => x.id)).toEqual(['chicken_pulao'])
    const reset = resolveRecipes(RECIPES, [{ id: 'chicken_pulao', reset: true, updatedAt: 2 }])
    expect(reset.recipes.map(x => x.id)).toContain('chicken_pulao')
  })
  it('adds your own recipes and drops deleted ones', () => {
    const mine = { id: 'my_toast', name: 'Toast', meals: ['breakfast' as const], tags: [], tiers: [{ name: 'Basic', mins: 5, effort: 1, add: ['bread:2'], steps: [] }], updatedAt: 1 }
    expect(resolveRecipes(RECIPES, [mine]).recipes).toHaveLength(21)
    expect(resolveRecipes(RECIPES, [{ ...mine, deletedAt: 2 }]).recipes).toHaveLength(20)
  })
  it('makes unique ids for new recipes', () => {
    expect(newRecipeId('Rajma Chawal!', new Set())).toBe('my_rajma_chawal')
    expect(newRecipeId('Rajma Chawal', new Set(['my_rajma_chawal']))).toBe('my_rajma_chawal_2')
  })
})
