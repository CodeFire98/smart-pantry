/** Typed client for the app's own /api routes (which proxy Swiggy's Instamart MCP). */

export class ApiError extends Error {
  constructor(public status: number, message: string, public reason?: string, public extra: Record<string, unknown> = {}) {
    super(message)
  }
}

async function req<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  let r: Response
  try {
    r = await fetch(path, {
      method: init?.method ?? 'GET',
      credentials: 'same-origin',
      headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
      body: init?.body ? JSON.stringify(init.body) : undefined
    })
  } catch {
    throw new ApiError(0, 'You seem to be offline. Instamart needs a connection.')
  }
  const data = await r.json().catch(() => ({})) as Record<string, unknown>
  if (!r.ok) {
    const { error, reason, ...extra } = data
    throw new ApiError(r.status, String(error ?? `Request failed (${r.status})`), reason as string | undefined, extra)
  }
  return data as T
}

export interface Address { id: string; label: string; line?: string; isDefault?: boolean }
export interface Status { authed: boolean; swiggy?: { connected: boolean; expiresAt: number | null; address: Address | null }; ordering?: boolean }
export interface Variation { spinId: string; skuId: string; name: string; quantityDescription: string; price: number; mrp: number; inStock: boolean; imageUrl: string | null; maxQuantity: number | null }
export interface Product { name: string; brand: string; productId: string; variations: Variation[] }
export interface CartItem { spinId: string; skuId: string; name: string; variant: string; quantity: number; inStock: boolean; mrp: number; price: number; imageUrl: string | null }
export interface Cart {
  empty: boolean; address: Address | null; items: CartItem[]; bill: { label: string; value: string }[]; toPay: string; total: number
  warnings: string[]; unserviceable: CartItem[]; removed: CartItem[]; capped: { spinId: string; itemName: string; requestedQuantity: number; cappedQuantity: number; reason?: string }[]
}
export interface PaymentOptions { upi: { id: string; name: string; iconUrl: string | null }[]; cod: { name: string } | null; swiggyMoney: { name: string } | null }
export interface PlacedOrder { orderId: string; status: string; paymentMethod: string; cartTotal?: number; paasId?: string; transactionId?: string; upiIntentUrl?: string; bridgeUrl?: string; pollingIntervalInMs?: number; maxTimeToPollForInMs?: number }
export interface PastOrder { orderId: string; status: string; createdAt: string; isActive: boolean; total: number; items: { name: string; quantity: number; itemId?: string | null }[] }

export const api = {
  status: () => req<Status>('/api/session'),
  login: (passcode: string) => req<{ authed: boolean }>('/api/session', { method: 'POST', body: { passcode } }),
  logout: () => req('/api/session', { method: 'DELETE' }),
  addresses: () => req<{ addresses: Address[]; selected: Address | null }>('/api/swiggy/addresses'),
  selectAddress: (a: Address) => req<{ selected: Address }>('/api/swiggy/select-address', { method: 'POST', body: a }),
  search: (query: string) => req<{ products: Product[] }>('/api/swiggy/search', { method: 'POST', body: { query } }),
  cart: () => req<{ cart: Cart }>('/api/swiggy/cart'),
  setCart: (items: { spinId: string; skuId: string; quantity: number }[]) => req<{ cart: Cart }>('/api/swiggy/cart-set', { method: 'POST', body: { items } }),
  paymentOptions: () => req<PaymentOptions>('/api/swiggy/payment-options'),
  confirmNonce: () => req<{ nonce: string; cart: Cart }>('/api/swiggy/confirm-nonce', { method: 'POST' }),
  checkout: (b: { nonce: string; paymentMethod: string; intentApp?: string }) => req<{ order: PlacedOrder }>('/api/swiggy/checkout', { method: 'POST', body: b }),
  paymentStatus: (b: { paasId: string; orderId: string }) => req<{ status: { status?: string; terminal?: boolean; isTerminalSuccess?: boolean; isTerminalFailure?: boolean } }>('/api/swiggy/payment-status', { method: 'POST', body: b }),
  confirmOrder: (b: { paasId: string; orderId: string; transactionId?: string }) => req<{ result: { result?: string; orderStatus?: string } }>('/api/swiggy/confirm-order', { method: 'POST', body: b }),
  orders: () => req<{ orders: PastOrder[] }>('/api/swiggy/orders'),
  orderDetails: (id: string) => req<{ order: { orderId: string; status: string; items: { name: string; quantity: number }[] } }>(`/api/swiggy/order-details?id=${encodeURIComponent(id)}`),
  deliveryStatus: (id: string) => req<{ status: { etaText?: string; statusText?: string; delivered?: boolean; cancelled?: boolean } }>(`/api/swiggy/delivery-status?id=${encodeURIComponent(id)}`),
  disconnect: () => req('/api/swiggy/disconnect', { method: 'POST' })
}
