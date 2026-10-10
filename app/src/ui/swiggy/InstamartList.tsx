import { useState } from 'react'
import { updateKitchen } from '../../store/db'
import { api, type Cart } from '../../swiggy/api'
import { useSwiggy } from '../../swiggy/useSwiggy'
import { useApp } from '../AppContext'
import { Icon } from '../components'
import { ImportSheet, type ImportOrder } from './ImportSheet'
import { OrderSheet } from './OrderSheet'
import { ProductPicker } from './ProductPicker'

/** The List tab when Instamart is connected: pick products, send them to the live cart, order, then restock. */
export function InstamartList() {
  const { kitchen, catalog, toast } = useApp()
  const { status, explain } = useSwiggy()
  const [picking, setPicking] = useState<string | null>(null)
  const [cart, setCart] = useState<Cart | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [ordering, setOrdering] = useState(false)
  const [importing, setImporting] = useState<ImportOrder[] | null>(null)
  const list = kitchen.list.filter(id => catalog[id])
  const sku = kitchen.skuMap ?? {}
  const ready = list.filter(id => sku[id])
  const estimate = ready.reduce((a, id) => a + sku[id].price * sku[id].qty, 0)

  const setQty = (id: string, d: number) => updateKitchen(k => {
    const s = k.skuMap?.[id]
    if (!s) return k
    return { ...k, skuMap: { ...k.skuMap, [id]: { ...s, qty: Math.max(1, Math.min(10, s.qty + d)) } } }
  })

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setErr(null)
    try { await fn() } catch (e) { setErr(e instanceof Error && !('status' in e) ? e.message : explain(e)) } finally { setBusy(false) }
  }
  const send = () => run(async () => {
    const r = await api.setCart(ready.map(id => ({ spinId: sku[id].spinId, skuId: sku[id].skuId, quantity: sku[id].qty })))
    setCart(r.cart)
    toast(`Instamart cart updated: ${r.cart.items.length} item${r.cart.items.length === 1 ? '' : 's'}`)
  })
  const refreshCart = () => run(async () => setCart((await api.cart()).cart))

  // Orders placed here already know each product and pack size. get_order_details is beta-only on Swiggy,
  // so fall back to the order-history entry for anything we didn't record.
  const delivered = (orderId: string) => run(async () => {
    const pending = kitchen.pendingOrders?.find(p => p.orderId === orderId)
    let items: ImportOrder['items'] = (pending?.lines ?? []).filter(l => catalog[l.id]).map(l => ({
      name: sku[l.id]?.name ?? catalog[l.id].name, quantity: l.packs, id: l.id, quantityDescription: l.quantityDescription
    }))
    if (!items.length) items = (await api.orders()).orders.find(o => o.orderId === orderId)?.items ?? []
    if (!items.length) throw new Error('Couldn’t find what was in this order. Add the items from Pantry → Instamart orders instead.')
    setImporting([{ orderId, label: 'Your Instamart order', items }])
  })
  const checkDelivery = (orderId: string) => run(async () => {
    const { status: s } = await api.deliveryStatus(orderId)
    toast(s.delivered ? 'Delivered. Tap “Delivered: add to pantry”.' : s.cancelled ? 'This order was cancelled.' : s.etaText ? `On the way · arriving in ${s.etaText}` : s.statusText || 'On the way')
  })

  return <>
    <div className="eyebrow">Instamart · delivering to {status?.swiggy?.address?.label}</div>
    <h1>Shopping list</h1>

    {(kitchen.pendingOrders ?? []).map(p => <div className="card" key={p.orderId} style={{ marginTop: 14 }}>
      <div className="card-top"><span className="card-name">Order on its way</span><span className="price">₹{p.total}</span></div>
      <div className="sub">{p.lines.map(l => catalog[l.id]?.name).filter(Boolean).join(', ') || `Order ${p.orderId}`}</div>
      <div className="row">
        <button className="btn sm ghost" disabled={busy} onClick={() => checkDelivery(p.orderId)}>Where is it?</button>
        <button className="btn sm accent" disabled={busy} onClick={() => delivered(p.orderId)}>{Icon.check}Delivered: add to pantry</button>
      </div>
    </div>)}

    <div className="section">
      {!list.length && <div className="empty">Your list is empty. Missing ingredients you add from a dish land here.</div>}
      {list.length > 0 && <div className="group">{list.map(id => {
        const s = sku[id]
        return <div className="prod" key={id}>
          {s?.imageUrl ? <img src={s.imageUrl} alt="" loading="lazy" /> : <span className="prod-ph" />}
          <span className="pname">{catalog[id].name}
            <small>{s ? <>{s.name} · {s.quantityDescription} · ₹{s.price} <button className="linkbtn" onClick={() => setPicking(id)}>Change</button></> : 'No product picked yet'}</small></span>
          {s
            ? <span className="stepper"><button onClick={() => setQty(id, -1)} aria-label={`Fewer ${catalog[id].name}`}>−</button><output>×{s.qty}</output><button onClick={() => setQty(id, 1)} aria-label={`More ${catalog[id].name}`}>+</button></span>
            : <button className="btn sm accent" onClick={() => setPicking(id)}>Pick</button>}
          <button className="x" onClick={() => updateKitchen(k => ({ ...k, list: k.list.filter(x => x !== id) }))} aria-label={`Remove ${catalog[id].name}`}>×</button>
        </div>
      })}</div>}
      {list.length > 0 && <>
        <div className="totals"><div className="grand"><span>Estimate ({ready.length} of {list.length} picked)</span><span className="price">₹{estimate}</span></div></div>
        <button className="btn accent block" disabled={busy || !ready.length} onClick={send}>{busy ? <span className="spin" /> : Icon.cart}Send to Instamart cart</button>
      </>}
      {err && <div className="sub missing">{err}</div>}
    </div>

    <div className="section">
      <div className="section-head"><h2>Instamart cart</h2><button className="linkbtn" disabled={busy} onClick={refreshCart}>Refresh</button></div>
      {!cart ? <div className="empty">Send your list, or tap Refresh to see what’s in your Instamart cart.</div>
        : cart.empty ? <div className="empty">Your Instamart cart is empty.</div>
        : <div className="card">
            {cart.removed.length > 0 && <div className="warn">Out of stock, removed: {cart.removed.map(i => i.name).join(', ')}</div>}
            {cart.capped.map(c => <div className="warn" key={c.spinId}>{c.itemName}: only {c.cappedQuantity} allowed{c.reason ? ` (${c.reason})` : ''}</div>)}
            {cart.warnings.map(w => <div className="warn" key={w}>{w}</div>)}
            <div className="group" style={{ border: 0, padding: 0 }}>{cart.items.map(i => <div className="prod" key={i.spinId}>
              {i.imageUrl ? <img src={i.imageUrl} alt="" loading="lazy" /> : <span className="prod-ph" />}
              <span className="pname">{i.name}<small>{i.variant} · ×{i.quantity}{!i.inStock && ' · out of stock'}</small></span>
              <span className="price">₹{i.price}</span>
            </div>)}</div>
            <div className="totals">{cart.bill.map(b => <div key={b.label}><span>{b.label}</span><span className="price">{b.value}</span></div>)}
              <div className="grand"><span>To pay</span><span className="price">{cart.toPay}</span></div></div>
            <button className="btn accent block" onClick={() => setOrdering(true)}>Review &amp; place order</button>
          </div>}
    </div>

    {picking && <ProductPicker id={picking} onClose={() => setPicking(null)} />}
    {ordering && <OrderSheet onClose={placed => { setOrdering(false); if (placed) setCart(null) }} />}
    {importing && <ImportSheet orders={importing} onClose={() => setImporting(null)} />}
  </>
}
