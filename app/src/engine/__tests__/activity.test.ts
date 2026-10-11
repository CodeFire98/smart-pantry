import { describe, expect, it } from 'vitest'
import { CATALOG, RECIPES, interpret, normalizeDraft, profileDue, summarizeActivity, summaryText, type ActivityEvent, type JournalEntry, type Recipe } from '..'

const now = Date.UTC(2026, 9, 11, 12)
const ev = (type: ActivityEvent['type'], extra: Partial<ActivityEvent> = {}, daysAgo = 1): ActivityEvent => ({ uid: crypto.randomUUID(), t: now - daysAgo * 86_400_000, type, ...extra })
const cook = (name: string, tier: string, rating: number | null, note = '', daysAgo = 1): JournalEntry =>
  ({ uid: crypto.randomUUID(), recipeId: name, recipeName: name, tier, tierIndex: 0, rating, note, at: now - daysAgo * 86_400_000 })

describe('summarizeActivity', () => {
  it('counts searches, opens, orders and cooks with average ratings', () => {
    const s = summarizeActivity([
      ev('search', { text: 'Paneer' }), ev('search', { text: 'paneer' }), ev('search', { text: 'avocado toast' }),
      ev('open', { names: ['Paneer Bhurji'] }), ev('order', { names: ['Curd', 'Milk'] }), ev('restock', { names: ['curd'] }),
      ev('recipe', { names: ['Spiced Avocado Toast'], text: 'ai' }),
      ev('search', { text: 'ancient' }, 400)
    ], [cook('Egg Bhurji', 'Basic', 4, 'more chilli'), cook('Egg Bhurji', 'Loaded', 5), cook('Old dish', 'Basic', 1, '', 300)], now)
    expect(s.searches).toEqual([['paneer', 2], ['avocado toast', 1]])
    expect(s.ordered[0]).toEqual(['curd', 2])
    expect(s.cooked).toEqual([{ dish: 'Egg Bhurji', times: 2, rating: 4.5, versions: ['Basic', 'Loaded'], notes: ['more chilli'] }])
    expect(s.recipesAdded).toEqual(['Spiced Avocado Toast (AI draft)'])
    expect(s.events).toBe(7)
    expect(summaryText(s)).toContain('Egg Bhurji ×2 (versions: Basic, Loaded) avg 4.5/5 notes: "more chilli"')
  })
})

describe('profileDue', () => {
  it('waits for enough activity, then refreshes weekly', () => {
    expect(profileDue(undefined, 3, now)).toBe(false)
    expect(profileDue(undefined, 10, now)).toBe(true)
    const p = { text: 'x', at: now - 3 * 86_400_000, by: 'ai' as const, events: 10 }
    expect(profileDue(p, 50, now)).toBe(false)
    expect(profileDue({ ...p, at: now - 8 * 86_400_000 }, 15, now)).toBe(false)
    expect(profileDue({ ...p, at: now - 8 * 86_400_000 }, 20, now)).toBe(true)
  })
})

describe('search by part of a dish name', () => {
  const toast: Recipe = { ...RECIPES[0], id: 'my_spiced_avocado_toast', name: 'Spiced Avocado Toast', aliases: [] }
  it('"avocado toast" finds "Spiced Avocado Toast" as a dish', () => {
    const it2 = interpret('avocado toast', [...RECIPES, toast], CATALOG)!
    expect(it2.dishes.map(d => d.id)).toEqual(['my_spiced_avocado_toast'])
  })
  it('single words still mean an ingredient or mood', () => {
    expect(interpret('toast', [...RECIPES, toast], CATALOG)!.dishes).toEqual([])
  })
})

describe('AI version names', () => {
  it('are trimmed to a whole word', () => {
    const raw = { name: 'Avocado Toast', meals: ['breakfast'], tags: [], tiers: [
      { name: 'Crunchy Desi Salad Avocado Toast Supreme', mins: 10, effort: 1, steps: ['a'], ingredients: [{ id: 'bread', amount: 2 }] }] }
    const d = normalizeDraft(raw, CATALOG, new Set())!
    expect(d.recipe.tiers[0].name).toBe('Crunchy Desi Salad Avocado Toast')
  })
})
