import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { guardMismatch, mergeCart, money, trimCart, type RawCart } from '../_lib/cart'
import { decrypt, encrypt } from '../_lib/crypto'
import { signSession, verifySession } from '../_lib/session'
import { SwiggyError, unwrap } from '../_lib/swiggy'
import { syncPrefix } from '../_lib/sync'
import { ALLOWED_MODELS } from '../_lib/ai'

const key = randomBytes(32)

describe('crypto', () => {
  it('round-trips and rejects tampering', () => {
    const blob = encrypt('secret-token', key)
    expect(blob).not.toContain('secret')
    expect(decrypt(blob, key)).toBe('secret-token')
    const bad = Buffer.from(blob, 'base64'); bad[bad.length - 1] ^= 1
    expect(() => decrypt(bad.toString('base64'), key)).toThrow()
    expect(() => decrypt(blob, randomBytes(32))).toThrow()
  })
})

describe('session cookie', () => {
  it('verifies a signed, unexpired session only', () => {
    const now = Date.now()
    expect(verifySession(signSession(now + 1000, key), now, key)).toBe(true)
    expect(verifySession(signSession(now - 1, key), now, key)).toBe(false)
    expect(verifySession(signSession(now + 1000, randomBytes(32)), now, key)).toBe(false)
    const [p, s] = signSession(now + 1000, key).split('.')
    const forged = Buffer.from(JSON.stringify({ v: 1, exp: now + 9e9 })).toString('base64url')
    expect(verifySession(`${forged}.${s}`, now, key)).toBe(false)
    expect(verifySession(`${p}`, now, key)).toBe(false)
    expect(verifySession(undefined, now, key)).toBe(false)
  })
})

describe('cart', () => {
  it('merges into the existing cart instead of replacing it', () => {
    const existing = [{ spinId: 'a', skuId: 'A', quantity: 1 }, { spinId: 'b', skuId: 'B', quantity: 2 }]
    expect(mergeCart(existing, [{ spinId: 'c', skuId: 'C', quantity: 1 }, { spinId: 'a', skuId: 'A', quantity: 3 }, { spinId: 'b', skuId: 'B', quantity: 0 }]))
      .toEqual([{ spinId: 'a', skuId: 'A', quantity: 3 }, { spinId: 'c', skuId: 'C', quantity: 1 }])
  })
  it('caps silly quantities', () => {
    expect(mergeCart([], [{ spinId: 'a', skuId: 'A', quantity: 99.7 }])[0].quantity).toBe(20)
  })
  it('parses money strings', () => {
    expect(money('₹1,234.50')).toBe(1234.5)
    expect(money(undefined)).toBe(0)
  })
  const raw: RawCart = {
    items: [{ spinId: 'a', skuId: 'A', itemName: 'Paneer', quantity: 2, isInStockAndAvailable: true, mrp: 100, discountedFinalPrice: 90 }],
    billBreakdown: { lineItems: [{ label: 'Item total', value: '₹180' }], toPay: { label: 'To pay', value: '₹210' } }
  }
  it('blocks checkout when the cart changed since confirmation', () => {
    const live = trimCart(raw)
    expect(live.total).toBe(210)
    expect(guardMismatch({ total: 210, count: 2 }, live)).toBeNull()
    expect(guardMismatch({ total: 200, count: 2 }, live)).toMatch(/total changed/)
    expect(guardMismatch({ total: 210, count: 1 }, live)).toMatch(/items/)
    expect(guardMismatch({ total: 210, count: 2 }, trimCart({ ...raw, items: [{ ...raw.items![0], isInStockAndAvailable: false }] }))).toMatch(/out of stock/)
    expect(guardMismatch({ total: 210, count: 2 }, trimCart({ cartAbsent: true }))).toMatch(/empty/)
  })
})

describe('envelope', () => {
  it('unwraps success from structured or text content', () => {
    expect(unwrap({ structuredContent: { success: true, data: { x: 1 } } }, 't')).toEqual({ x: 1 })
    expect(unwrap({ content: [{ type: 'text', text: JSON.stringify({ success: true, data: [1] }) }] }, 't')).toEqual([1])
    // Live shape: payload directly in structuredContent, prose in the text content.
    expect(unwrap({ structuredContent: { addresses: [{ id: 'a' }] }, content: [{ type: 'text', text: 'You have 1 address' }] }, 't')).toEqual({ addresses: [{ id: 'a' }] })
  })
  it('treats an isError structured envelope as a failure', () => {
    expect(() => unwrap({ isError: true, structuredContent: { success: false, error: { message: 'No delivery addresses found.' } } }, 'get_cart')).toThrow('No delivery addresses found.')
  })
  it('maps failures to input or domain errors', () => {
    const fail = (message: string) => ({ content: [{ type: 'text', text: JSON.stringify({ success: false, error: { message } }) }] })
    expect(() => unwrap(fail('Invalid addressId'), 't')).toThrow(SwiggyError)
    try { unwrap(fail('Item out of stock'), 't') } catch (e) { expect((e as SwiggyError).kind).toBe('domain'); expect((e as SwiggyError).status).toBe(409) }
    try { unwrap(fail('Missing query'), 't') } catch (e) { expect((e as SwiggyError).kind).toBe('input') }
  })
})

describe('sync key isolation', () => {
  it('keeps development data away from production', () => {
    expect(syncPrefix('production')).toBe('sp:sync:')
    expect(syncPrefix('development')).toBe('sp-dev:sync:')
    expect(syncPrefix('preview')).toBe('sp-dev:sync:')
    expect(syncPrefix(undefined)).toBe('sp-dev:sync:')
  })
})

describe('AI guardrails', () => {
  it('only free Flash models are allowed', async () => {
    const re = ALLOWED_MODELS
    for (const ok of ['gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-flash-latest', 'gemini-3.8-flash']) expect(re.test(ok)).toBe(true)
    for (const no of ['gemini-3.1-pro-preview', 'gemini-2.5-pro', 'gemini-pro-latest', 'nano-banana-pro-preview', 'gemini-omni-flash-preview']) expect(re.test(no)).toBe(false)
  })
})

describe('activity events', () => {
  it('keeps only well-formed events and clips their strings', async () => {
    const { cleanActivity } = await import('../_lib/sync.js')
    const out = cleanActivity([
      { uid: '11111111-2222', t: 1, type: 'search', text: 'x'.repeat(500), extra: 'dropped' },
      { uid: 'bad uid!', t: 1, type: 'search' },
      { uid: '33333333-4444', t: 2, type: 'hack' },
      { uid: '55555555-6666', t: 3, type: 'order', names: ['Milk', 7, 'Curd'], n: 168 }
    ])
    expect(out).toEqual([
      { uid: '11111111-2222', t: 1, type: 'search', text: 'x'.repeat(120) },
      { uid: '55555555-6666', t: 3, type: 'order', names: ['Milk', 'Curd'], n: 168 }
    ])
  })
})
