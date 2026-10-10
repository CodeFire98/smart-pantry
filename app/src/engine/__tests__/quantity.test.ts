import { describe, expect, it } from 'vitest'
import { CATALOG, kitchenFromSeed, matchOrderItem, packAmount, parseQuantity, restockAmounts } from '..'

describe('parseQuantity', () => {
  it.each([
    ['500 g', { amount: 500, unit: 'g' }],
    ['1 kg', { amount: 1000, unit: 'g' }],
    ['1 L', { amount: 1000, unit: 'ml' }],
    ['500 ml', { amount: 500, unit: 'ml' }],
    ['6 pcs', { amount: 6, unit: 'pc' }],
    ['1 dozen', { amount: 12, unit: 'pc' }],
    ['2 x 200 g', { amount: 400, unit: 'g' }],
    ['Pack of 2 (500 g each)', { amount: 1000, unit: 'g' }],
    ['1.5 kg', { amount: 1500, unit: 'g' }],
    ['6', { amount: 6, unit: 'pc' }]
  ])('%s', (s, want) => expect(parseQuantity(s)).toEqual(want))
  it('returns null for unknown text', () => expect(parseQuantity('1 bunch')).toBeNull())
})

describe('packAmount', () => {
  it('uses the pack text when units agree, else the catalog pack', () => {
    expect(packAmount('paneer', '200 g', CATALOG)).toBe(200)
    expect(packAmount('eggs', '12 pcs', CATALOG)).toBe(12)
    expect(packAmount('bread', '400 g', CATALOG)).toBe(14)
    expect(packAmount('salt', '1 kg', CATALOG)).toBeNull()
  })
})

describe('matchOrderItem', () => {
  const k = { skuMap: {} }
  it.each([
    ['Amul Taaza Toned Milk', 'milk'],
    ['Fresh Malai Paneer', 'paneer'],
    ['Tomato - Hybrid', 'tomato'],
    ['Onion (Pyaz)', 'onion'],
    ['Safal Frozen Green Peas', 'peas'],
    ['Farm Fresh Eggs - Pack of 6', 'eggs'],
    ['Catch Coriander Powder', 'coriander_powder'],
    ['Pintola Peanut Butter Crunchy', 'peanut_butter'],
    ['Everest Chilli Flakes', 'chilli_flakes'],
    ['Lotus Spices Elaichi Green', 'cardamom'],
    ['Daawat Sona Masoori', 'rice'],
    ['Supreme Harvest Bayleaf', 'bay_leaf'],
    ['NOICE Fresh Malai Paneer (Handmade Daily)', 'paneer'],
    ['Supreme Harvest Black Pepper (Whole)', 'pepper'],
    ['Nandini Dahi', 'curd']
  ])('%s → %s', (name, id) => expect(matchOrderItem(name, k, CATALOG)?.id).toBe(id))
  it('prefers a product you picked', () => {
    const picked = { skuMap: { curd: { spinId: 's', skuId: 'k', name: 'Nandini Good Life Dahi', quantityDescription: '500 g', price: 35, imageUrl: null, qty: 1 } } }
    expect(matchOrderItem('Nandini Good Life Dahi', picked, CATALOG)).toEqual({ id: 'curd', via: 'picked' })
  })
  it('returns null when nothing fits', () => expect(matchOrderItem('Beco Natural Dishwash Gel', k, CATALOG)).toBeNull())
})

describe('restockAmounts', () => {
  it('adds exact amounts and refreshes expiry', () => {
    const k = { ...kitchenFromSeed('2026-10-10'), list: ['paneer', 'capsicum'] }
    const out = restockAmounts([{ id: 'paneer', amount: 200 }, { id: 'green_chilli', amount: null }], k, CATALOG, '2026-10-10')
    expect(out.items.paneer).toEqual({ q: 400, exp: '2026-10-14' })
    expect(out.items.green_chilli).toEqual({ l: 3, exp: '2026-10-17' })
    expect(out.list).toEqual(['capsicum'])
  })
})

describe('matchOrderItem by item id', () => {
  it('uses the Instamart item id of a product you picked', () => {
    const k = { skuMap: { paneer: { spinId: 'SP1', skuId: 'SK1', name: 'Milky Mist Paneer', quantityDescription: '200 g', price: 109, imageUrl: null, qty: 1 } } }
    expect(matchOrderItem('Some Renamed Product', k, CATALOG, 'SK1')).toEqual({ id: 'paneer', via: 'picked' })
  })
})
