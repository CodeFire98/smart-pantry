import type { VercelRequest } from '@vercel/node'
import { guardMismatch, mergeCart, trimCart, trimProducts, type CartLine, type RawCart, type RawProduct } from '../_lib/cart.js'
import { randomToken } from '../_lib/crypto.js'
import { HttpError, body, route, str } from '../_lib/http.js'
import { KEYS, redis } from '../_lib/redis.js'
import { requireSession } from '../_lib/session.js'
import { SwiggyError, disconnect, withSwiggy, type Call } from '../_lib/swiggy.js'

type Address = { id: string; label: string }

async function selectedAddress(): Promise<Address> {
  const a = await redis().get<Address>(KEYS.address)
  if (!a) throw new HttpError(409, 'Pick a delivery address first.', { reason: 'address' })
  return a
}

/** Swiggy answers get_cart with an error (not an empty cart) when nothing is in it yet, so treat that as empty. */
async function liveCart(call: Call) {
  try { return trimCart(await call<RawCart>('get_cart')) } catch (e) {
    if (e instanceof SwiggyError && e.kind === 'domain') return trimCart({ cartAbsent: true })
    throw e
  }
}

const ACTIONS: Record<string, { method: 'GET' | 'POST'; run: (req: VercelRequest) => Promise<unknown> }> = {
  addresses: {
    method: 'GET',
    run: () => withSwiggy(async call => {
      type Page = {
        addresses?: Array<{ id: string; addressLine: string; addressTag?: string; addressCategory?: string }>
        pagination?: { hasMore?: boolean }
        resolution?: { defaultAddressId?: string }
      }
      const all: NonNullable<Page['addresses']> = []
      let defaultId: string | undefined
      for (let page = 1; page <= 5; page++) {
        const d = await call<Page>('get_addresses', { page, pageSize: 10 })
        all.push(...(d.addresses ?? []))
        defaultId ??= d.resolution?.defaultAddressId
        if (!d.pagination?.hasMore) break
      }
      const addresses = all.map(a => ({ id: a.id, label: a.addressTag || a.addressCategory || 'Address', line: a.addressLine, isDefault: a.id === defaultId }))
      addresses.sort((a, b) => Number(b.isDefault) - Number(a.isDefault))
      return { addresses, selected: await redis().get<Address>(KEYS.address) }
    })
  },

  'select-address': {
    method: 'POST',
    run: async req => {
      const b = body<{ id: unknown; label: unknown }>(req)
      const addr = { id: str(b.id, 'address id'), label: typeof b.label === 'string' ? b.label.slice(0, 40) : 'Address' }
      await redis().set(KEYS.address, addr)
      return { selected: addr }
    }
  },

  search: {
    method: 'POST',
    run: async req => {
      const query = str(body(req).query, 'search text', 80)
      const { id } = await selectedAddress()
      return withSwiggy(async call => {
        const d = await call<{ products?: RawProduct[] }>('search_products', { addressId: id, query })
        return { products: trimProducts(d.products) }
      })
    }
  },

  cart: { method: 'GET', run: () => withSwiggy(async call => ({ cart: await liveCart(call) })) },

  /** {items:[{spinId, skuId, quantity}]} — merged into the live cart (quantity 0 removes). */
  'cart-set': {
    method: 'POST',
    run: async req => {
      const raw = body<{ items?: unknown }>(req).items
      if (!Array.isArray(raw) || raw.length > 40) throw new HttpError(400, 'Missing or invalid items')
      const adds: CartLine[] = raw.map(i => {
        const x = i as Record<string, unknown>
        return { spinId: str(x.spinId, 'spinId'), skuId: str(x.skuId, 'skuId'), quantity: Number(x.quantity) || 0 }
      })
      const { id } = await selectedAddress()
      return withSwiggy(async call => {
        const current = await liveCart(call)
        const sameAddress = !current.address || current.address.id === id
        const base = sameAddress ? current.items.map(i => ({ spinId: i.spinId, skuId: i.skuId, quantity: i.quantity })) : []
        const items = mergeCart(base, adds)
        if (!sameAddress) await call('clear_cart')
        const updated = trimCart(await call<RawCart>('update_cart', { selectedAddressId: id, items }))
        return { cart: updated.items.length || updated.empty ? updated : await liveCart(call) }
      })
    }
  },

  'payment-options': {
    method: 'GET',
    run: () => withSwiggy(async call => {
      type M = { id: string; displayName?: string; iconUrl?: string; enabled?: boolean; kind?: string }
      const d = await call<{ platforms?: { mobile?: { methods: M[] } }; cod?: { available: boolean; displayName: string }; swiggyMoney?: { available: boolean; displayName: string } }>('get_payment_options')
      return {
        upi: (d.platforms?.mobile?.methods ?? []).filter(m => m.enabled !== false).map(m => ({ id: m.id, name: m.displayName ?? m.id, iconUrl: m.iconUrl ?? null })),
        cod: d.cod?.available ? { name: d.cod.displayName || 'Cash on delivery' } : null,
        swiggyMoney: d.swiggyMoney?.available ? { name: d.swiggyMoney.displayName || 'Swiggy Money' } : null
      }
    })
  },

  /** Snapshot the cart the user is about to confirm; checkout must present this single-use nonce. */
  'confirm-nonce': {
    method: 'POST',
    run: () => withSwiggy(async call => {
      const cart = await liveCart(call)
      if (cart.empty) throw new HttpError(409, 'Your Instamart cart is empty.')
      const nonce = randomToken(18)
      await redis().set(KEYS.nonce(nonce), { total: cart.total, count: cart.items.reduce((a, i) => a + i.quantity, 0) }, { ex: 120 })
      return { nonce, cart }
    })
  },

  checkout: {
    method: 'POST',
    run: async req => {
      if (process.env.ALLOW_CHECKOUT !== 'true') throw new HttpError(403, 'Ordering is switched off on this server.', { reason: 'ordering_off' })
      const b = body<{ nonce: unknown; paymentMethod: unknown; intentApp?: unknown }>(req)
      const nonce = str(b.nonce, 'confirmation')
      const paymentMethod = str(b.paymentMethod, 'payment method', 20)
      if (!['UPI', 'COD', 'Cash', 'SwiggyPay'].includes(paymentMethod)) throw new HttpError(400, 'Invalid payment method')
      const intentApp = paymentMethod === 'UPI' ? str(b.intentApp, 'UPI app', 120) : undefined
      const snap = await redis().getdel<{ total: number; count: number }>(KEYS.nonce(nonce))
      if (!snap) throw new HttpError(409, 'This confirmation expired. Review the order again.', { reason: 'stale' })
      const { id } = await selectedAddress()
      return withSwiggy(async call => {
        const live = await liveCart(call)
        const problem = guardMismatch(snap, live)
        if (problem) throw new HttpError(409, problem, { reason: 'stale', cart: live })
        try {
          // Never retried: checkout is not idempotent.
          const order = await call<Record<string, unknown>>('checkout', { addressId: id, paymentMethod, ...(intentApp ? { intentApp } : {}) }, { retry: false })
          return { order: pick(order, ['orderId', 'status', 'paymentMethod', 'cartTotal', 'paasId', 'transactionId', 'upiIntentUrl', 'bridgeUrl', 'pollingIntervalInMs', 'maxTimeToPollForInMs']) }
        } catch (e) {
          if (e instanceof SwiggyError && e.kind === 'upstream') {
            // Unclear outcome: look for an order instead of retrying.
            const recent = await call<{ orders?: Array<{ orderId: string; status: string; isActive: boolean; totalAmount: number }> }>('get_orders', { count: 3, activeOnly: true }).catch(() => ({ orders: [] }))
            throw new HttpError(502, 'Swiggy didn’t confirm the order. Check “Recent orders” before trying again.', { reason: 'unclear', recent: recent.orders ?? [] })
          }
          throw e
        }
      })
    }
  },

  'payment-status': {
    method: 'POST',
    run: async req => {
      const b = body<{ paasId: unknown; orderId: unknown }>(req)
      const args = { paasId: str(b.paasId, 'payment id'), orderId: str(b.orderId, 'order id') }
      return withSwiggy(async call => ({ status: pick(await call('check_payment_status', args), ['status', 'terminal', 'isTerminalSuccess', 'isTerminalFailure', 'confirmed', 'orderStatus']) }))
    }
  },

  'confirm-order': {
    method: 'POST',
    run: async req => {
      const b = body<{ paasId: unknown; orderId: unknown; transactionId?: unknown }>(req)
      const args = { orderId: str(b.orderId, 'order id'), paasId: str(b.paasId, 'payment id'), ...(typeof b.transactionId === 'string' ? { transactionId: b.transactionId } : {}) }
      return withSwiggy(async call => ({ result: pick(await call('confirm_order', args, { retry: false }), ['orderId', 'orderStatus', 'result']) }))
    }
  },

  orders: {
    method: 'GET',
    run: () => withSwiggy(async call => {
      type O = { orderId: string; status: string; createdAt: string; isActive: boolean; totalAmount: number; orderType?: string; items?: Array<{ name: string; quantity: number; itemId?: string }> }
      const d = await call<{ orders?: O[] }>('get_orders', { count: 10 })
      return { orders: (d.orders ?? []).map(o => ({ orderId: o.orderId, status: o.status, createdAt: o.createdAt, isActive: o.isActive, total: o.totalAmount, items: (o.items ?? []).map(i => ({ name: i.name, quantity: i.quantity, itemId: i.itemId ?? null })) })) }
    })
  },

  'order-details': {
    method: 'GET',
    run: req => withSwiggy(async call => {
      const d = await call<{ orderId: string; status: string; items?: Array<{ name: string; quantity: number; finalPrice: number; removed: boolean }> }>('get_order_details', { orderId: str(req.query.id, 'order id') })
      return { order: { orderId: d.orderId, status: d.status, items: (d.items ?? []).filter(i => !i.removed).map(i => ({ name: i.name, quantity: i.quantity })) } }
    })
  },

  'delivery-status': {
    method: 'GET',
    run: async req => {
      const { id } = await selectedAddress()
      return withSwiggy(async call => ({ status: pick(await call('get_delivery_status', { orderId: str(req.query.id, 'order id'), addressId: id }), ['etaText', 'statusText', 'delivered', 'cancelled', 'deliveryBy', 'pollIntervalSec']) }))
    }
  },

  'report-error': {
    method: 'POST',
    run: async req => {
      const b = body<{ tool: unknown; message: unknown; flow?: unknown }>(req)
      return withSwiggy(async call => ({
        report: await call('report_error', { tool: str(b.tool, 'tool'), domain: 'im', errorMessage: str(b.message, 'message', 500), flowDescription: typeof b.flow === 'string' ? b.flow.slice(0, 300) : undefined })
      }))
    }
  },

  disconnect: { method: 'POST', run: async () => { await disconnect(); return { connected: false } } }
}

function pick(o: unknown, keys: string[]) {
  const src = (o ?? {}) as Record<string, unknown>
  return Object.fromEntries(keys.filter(k => src[k] !== undefined).map(k => [k, src[k]]))
}

export default route(['GET', 'POST'], async req => {
  requireSession(req)
  const action = ACTIONS[String(req.query.action)]
  if (!action) throw new HttpError(404, 'Unknown action')
  if (req.method !== action.method) throw new HttpError(405, 'Method not allowed')
  return action.run(req)
})
