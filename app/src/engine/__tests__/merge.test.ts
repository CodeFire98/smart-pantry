import { describe, expect, it } from 'vitest'
import { isPristine, kitchenFromSeed, mergeJournal, mergeKitchen, mergeRecipes, stampKitchen, stampPreSync, type JournalEntry, type Kitchen } from '..'

const seed = () => kitchenFromSeed('2026-10-11')
const edit = (k: Kitchen, now: number, fn: (k: Kitchen) => void) => { const n = structuredClone(k); fn(n); return stampKitchen(k, n, now) }

describe('stampKitchen', () => {
  it('stamps only what changed', () => {
    const a = seed()
    const b = edit(a, 100, k => { k.items.paneer.q = 400; k.list.push('capsicum') })
    expect(b.items.paneer.t).toBe(100)
    expect(b.items.eggs.t).toBeUndefined()
    expect(b.fieldT).toEqual({ list: 100 })
  })
  it('records deletions as tombstones', () => {
    const a = edit(seed(), 100, k => { k.items.my_coconut = { q: 0 } })
    const b = edit(a, 200, k => { delete k.items.my_coconut })
    expect(b.tombstones).toEqual({ my_coconut: 200 })
  })
})

describe('mergeKitchen', () => {
  it('keeps edits to different items from both devices', () => {
    const base = seed()
    const phone = edit(base, 100, k => { k.items.paneer.q = 0 })
    const laptop = edit(base, 150, k => { k.items.eggs.q = 12 })
    const m = mergeKitchen(phone, laptop)
    expect(m.items.paneer.q).toBe(0)
    expect(m.items.eggs.q).toBe(12)
  })
  it('newest edit wins for the same item, whichever side it is on', () => {
    const base = seed()
    const older = edit(base, 100, k => { k.items.milk.q = 0 })
    const newer = edit(base, 200, k => { k.items.milk.q = 1000 })
    expect(mergeKitchen(older, newer).items.milk.q).toBe(1000)
    expect(mergeKitchen(newer, older).items.milk.q).toBe(1000)
  })
  it('newest wins per field (list, product picks…)', () => {
    const base = seed()
    const a = edit(base, 100, k => { k.list = ['capsicum'] })
    const b = edit(base, 300, k => { k.list = ['chicken'] })
    expect(mergeKitchen(a, b).list).toEqual(['chicken'])
    expect(mergeKitchen(b, a).list).toEqual(['chicken'])
  })
  it('a deletion beats an older copy but not a newer edit', () => {
    const withItem = edit(seed(), 100, k => { k.items.my_x = { q: 1 } })
    const deleted = edit(withItem, 200, k => { delete k.items.my_x })
    expect(mergeKitchen(withItem, deleted).items.my_x).toBeUndefined()
    expect(mergeKitchen(deleted, withItem).items.my_x).toBeUndefined()
    const readded = edit(withItem, 300, k => { k.items.my_x = { q: 5 } })
    expect(mergeKitchen(deleted, readded).items.my_x?.q).toBe(5)
  })
  it('unions imported orders and drops their pending entries', () => {
    const a: Kitchen = { ...seed(), importedOrders: ['o1'], pendingOrders: [{ orderId: 'o2', at: 1, total: 1, lines: [] }], fieldT: { pendingOrders: 50 } }
    const b: Kitchen = { ...seed(), importedOrders: ['o2'], fieldT: {} }
    const m = mergeKitchen(a, b)
    expect(m.importedOrders?.sort()).toEqual(['o1', 'o2'])
    expect(m.pendingOrders).toEqual([])
  })
  it('detects an untouched device', () => {
    expect(isPristine(seed())).toBe(true)
    expect(isPristine(edit(seed(), 1, k => { k.items.eggs.q = 5 }))).toBe(false)
  })
})

describe('mergeJournal / mergeRecipes', () => {
  const j = (uid: string, updatedAt: number, note = ''): JournalEntry => ({ uid, updatedAt, at: 1, note, recipeId: 'r', recipeName: 'R', tier: 'Basic', tierIndex: 0, rating: null })
  it('unions entries and keeps the newer edit', () => {
    const r = mergeJournal([j('a', 5, 'local'), j('b', 1)], [j('a', 3, 'remote'), j('c', 2)])
    expect(r.merged.find(x => x.uid === 'a')!.note).toBe('local')
    expect(r.toPush.map(x => x.uid).sort()).toEqual(['a', 'b'])
    expect(r.toPull.map(x => x.uid)).toEqual(['c'])
  })
  it('syncs deletions as soft deletes', () => {
    const r = mergeJournal([{ ...j('a', 9), deletedAt: 9 }], [j('a', 3)])
    expect(r.merged[0].deletedAt).toBe(9)
  })
  it('recipes: newest wins by id', () => {
    const r = mergeRecipes([{ id: 'x', name: 'Old', meals: ['lunch'], tags: [], tiers: [], updatedAt: 1 }], [{ id: 'x', name: 'New', meals: ['lunch'], tags: [], tiers: [], updatedAt: 2 }])
    expect(r.merged[0].name).toBe('New')
  })
})

describe('stampPreSync (first sync on a device)', () => {
  it('stamps only real edits, so they beat untouched starting values elsewhere', () => {
    const s = seed()
    const local = structuredClone(s); local.items.paneer.q = 0; local.list = ['paneer']
    const stamped = stampPreSync(local, s, 500)
    expect(stamped.items.paneer.t).toBe(500)
    expect(stamped.items.eggs.t).toBeUndefined()
    expect(stamped.fieldT).toEqual({ list: 500 })
    expect(isPristine(stampPreSync(structuredClone(s), s, 500))).toBe(true)
    // the edited device wins against an untouched one, in either merge order
    expect(mergeKitchen(stamped, s).items.paneer.q).toBe(0)
    expect(mergeKitchen(s, stamped).items.paneer.q).toBe(0)
  })
})

describe('ingredient edits sync as a field', () => {
  it('newest ingredientEdits wins', () => {
    const base = seed()
    const a = edit(base, 100, k => { k.ingredientEdits = { paneer: { name: 'Malai paneer' } } })
    const b = edit(base, 200, k => { k.ingredientEdits = { paneer: { pack: 250 } } })
    expect(mergeKitchen(a, b).ingredientEdits).toEqual({ paneer: { pack: 250 } })
  })
})

describe('merging two untouched kitchens', () => {
  it('stays pristine (no zero timestamps recorded)', () => {
    const m = mergeKitchen(seed(), seed())
    expect(m.fieldT).toEqual({})
    expect(isPristine(m)).toBe(true)
  })
})
