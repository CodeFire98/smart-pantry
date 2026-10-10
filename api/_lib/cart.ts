/** Pure helpers for cart handling and response trimming, kept separate so they can be unit-tested. */

export interface CartLine { spinId: string; skuId: string; quantity: number }

export interface RawCartItem {
  spinId: string; skuId: string; productId?: string; itemName: string; itemVariant?: string; quantity: number
  isInStockAndAvailable: boolean; mrp: number; discountedFinalPrice: number; imageUrl?: string; maxQuantity?: number
}
export interface RawCart {
  selectedAddressDetails?: { id: string; annotation?: string; area?: string; address?: string }
  cartTotalAmount?: string
  items?: RawCartItem[]
  billBreakdown?: { lineItems: Array<{ label: string; value: string }>; toPay: { label: string; value: string } }
  addressWarning?: string
  unserviceableItems?: RawCartItem[]
  cartAbsent?: boolean
  cartWarning?: { statusCode: number; message: string }
  removedOutOfStockItems?: RawCartItem[]
  reducedQuantityItems?: Array<{ spinId: string; itemName: string; requestedQuantity: number; cappedQuantity: number; reason?: string }>
}

/**
 * update_cart replaces the whole cart, so merge: keep what's already there, set quantities for `adds`
 * (quantity 0 removes a line). Order: existing lines first, then new ones.
 */
export function mergeCart(existing: CartLine[], adds: CartLine[]): CartLine[] {
  const out = new Map(existing.map(l => [l.spinId, { ...l }]))
  for (const a of adds) {
    if (a.quantity <= 0) out.delete(a.spinId)
    else out.set(a.spinId, { spinId: a.spinId, skuId: a.skuId, quantity: Math.min(Math.floor(a.quantity), 20) })
  }
  return [...out.values()]
}

/** Payable amount as a number from "₹1,234.50"-style strings. */
export const money = (s: string | undefined) => Number(String(s ?? '').replace(/[^\d.]/g, '')) || 0

export function trimCart(c: RawCart) {
  const item = (i: RawCartItem) => ({
    spinId: i.spinId, skuId: i.skuId, name: i.itemName, variant: i.itemVariant ?? '', quantity: i.quantity,
    inStock: i.isInStockAndAvailable, mrp: i.mrp, price: i.discountedFinalPrice, imageUrl: i.imageUrl ?? null, maxQuantity: i.maxQuantity ?? null
  })
  const toPay = c.billBreakdown?.toPay?.value ?? c.cartTotalAmount ?? '0'
  return {
    empty: !!c.cartAbsent || !(c.items?.length),
    address: c.selectedAddressDetails ? { id: c.selectedAddressDetails.id, label: c.selectedAddressDetails.annotation || c.selectedAddressDetails.area || 'Address' } : null,
    items: (c.items ?? []).map(item),
    bill: c.billBreakdown?.lineItems ?? [],
    toPay,
    total: money(toPay),
    warnings: [c.addressWarning, c.cartWarning?.message].filter(Boolean) as string[],
    unserviceable: (c.unserviceableItems ?? []).map(item),
    removed: (c.removedOutOfStockItems ?? []).map(item),
    capped: c.reducedQuantityItems ?? []
  }
}
export type Cart = ReturnType<typeof trimCart>

/** What the confirm sheet showed must still be true when checkout runs. */
export function guardMismatch(snapshot: { total: number; count: number }, live: Cart): string | null {
  const count = live.items.reduce((a, i) => a + i.quantity, 0)
  if (live.empty) return 'Your Instamart cart is empty now.'
  if (Math.abs(live.total - snapshot.total) > 0.009) return `The total changed from ₹${snapshot.total} to ₹${live.total}. Check the cart again.`
  if (count !== snapshot.count) return 'The items in your cart changed. Check the cart again.'
  if (live.items.some(i => !i.inStock) || live.unserviceable.length) return 'Some items are out of stock now. Check the cart again.'
  return null
}

export interface RawProduct {
  displayName: string; brand: string; inStock: boolean; isAvail: boolean; productId: string
  variations: Array<{
    spinId: string; skuId: string; quantityDescription: string; displayName: string; brandName: string
    price: { mrp: number; offerPrice: number }; isInStockAndAvailable: boolean; imageUrl?: string; maxQuantity?: number
  }>
}

export function trimProducts(products: RawProduct[] = [], limit = 12) {
  return products.slice(0, limit).map(p => ({
    name: p.displayName, brand: p.brand, productId: p.productId,
    variations: (p.variations ?? []).map(v => ({
      spinId: v.spinId, skuId: v.skuId, name: v.displayName || p.displayName, quantityDescription: v.quantityDescription,
      price: v.price?.offerPrice ?? v.price?.mrp ?? 0, mrp: v.price?.mrp ?? 0, inStock: v.isInStockAndAvailable,
      imageUrl: v.imageUrl ?? null, maxQuantity: v.maxQuantity ?? null
    }))
  }))
}
