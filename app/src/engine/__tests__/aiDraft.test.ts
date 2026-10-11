import { describe, expect, it } from 'vitest'
import { CATALOG, RECIPES, applyAiFilters, normalizeDraft, scanToRows } from '..'

const raw = {
  name: 'Rajma Chawal', why: 'Uses your rice', meals: ['lunch', 'dinner', 'brunch'], tags: ['Comfort', 'protein'], plate: 'steel', color: '#8E3317',
  tiers: [
    { name: 'Basic', mins: 45, effort: 2, steps: ['Soak rajma', 'Pressure cook'], ingredients: [
      { id: 'new_rajma', amount: 80 }, { id: 'rice', amount: 80 }, { id: 'onion', amount: 1 }, { id: 'salt', amount: 0 } ] },
    { name: 'Classic', mins: 50, effort: 9, steps: ['Add ghee tadka'], ingredients: [
      { id: 'ghee', amount: 0, substitute: 'oil' }, { id: 'kasuri_methi', amount: 0, optional: true }, { id: 'Green Chillies', amount: 0 } ] }
  ],
  newIngredients: [{ id: 'new_rajma', name: 'rajma', unit: 'g', cat: 'shelf' }, { id: 'new_unused', name: 'saffron', unit: 'g', cat: 'spices' }]
}

describe('normalizeDraft', () => {
  it('builds a valid recipe and maps ingredients to the catalog', () => {
    const d = normalizeDraft(raw, CATALOG, new Set(RECIPES.map(r => r.id)))!
    expect(d.recipe.id).toBe('my_rajma_chawal')
    expect(d.recipe.meals).toEqual(['lunch', 'dinner'])
    expect(d.recipe.tags).toEqual(['comfort', 'protein'])
    expect(d.recipe.tiers[0].add).toEqual(['my_rajma:80', 'rice:80', 'onion:1', 'salt'])
    expect(d.recipe.tiers[1].effort).toBe(3)
    expect(d.recipe.tiers[1].add).toEqual(['ghee|oil', '?kasuri_methi', 'green_chilli'])
    expect(d.newIngredients).toEqual({ my_rajma: { name: 'Rajma', cat: 'shelf', unit: 'g' } })
    expect(d.why).toBe('Uses your rice')
  })
  it('rejects unusable replies', () => {
    expect(normalizeDraft({ name: '', tiers: [] }, CATALOG, new Set())).toBeNull()
    expect(normalizeDraft({ name: 'X', tiers: [{ ingredients: [] }] }, CATALOG, new Set())).toBeNull()
  })
})

describe('applyAiFilters', () => {
  it('prefers named dishes, else filters by tags, ingredients, meal and time', () => {
    expect(applyAiFilters({ dishes: ['Spicy Egg Curry'] }, RECIPES, CATALOG).map(r => r.id)).toEqual(['egg_curry'])
    const light = applyAiFilters({ tags: ['light'], maxMins: 30 }, RECIPES, CATALOG)
    expect(light.length).toBeGreaterThan(0)
    expect(light.every(r => r.tags.includes('light') && r.tiers[0].mins <= 30)).toBe(true)
    expect(applyAiFilters({}, RECIPES, CATALOG)).toEqual([])
  })
})

describe('scanToRows', () => {
  it('matches bill lines with amounts in the pantry unit', () => {
    const rows = scanToRows([
      { name: 'Amul Taaza Toned Milk 1L', catalogId: 'milk', packs: 2, size: 1000, unit: 'ml' },
      { name: 'Farm Eggs (12 pcs)', catalogId: '', packs: 1, size: 12, unit: 'pc' },
      { name: 'Eggs', catalogId: 'eggs', packs: 6, size: 0, unit: 'pc' },
      { name: 'Milky Mist Paneer 200g', catalogId: 'paneer', packs: 2, size: 0, unit: 'unknown' },
      { name: 'Dishwash gel', catalogId: '', packs: 1, size: 0, unit: 'unknown' }
    ], { skuMap: {} }, CATALOG)
    expect(rows.map(r => [r.id, r.amount, r.include])).toEqual([['milk', 2000, true], ['eggs', 12, true], ['eggs', 6, true], ['paneer', 400, true], ['', null, false]])
  })
})
