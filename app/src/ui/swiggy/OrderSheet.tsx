import { useEffect, useRef, useState } from 'react'
import { updateKitchen } from '../../store/db'
import { api, ApiError, type Cart, type PaymentOptions, type PlacedOrder } from '../../swiggy/api'
import { useSwiggy } from '../../swiggy/useSwiggy'
import { useApp } from '../AppContext'
import { Icon } from '../components'

type Method = { key: string; label: string; paymentMethod: string; intentApp?: string }

/**
 * The one place an order can be placed. Shows the live cart and the payment methods Swiggy offers,
 * and needs a deliberate tap. The server re-checks the cart against this snapshot before checkout.
 */
export function OrderSheet({ onClose }: { onClose: (placed?: boolean) => void }) {
  const { kitchen, toast } = useApp()
  const { status, explain } = useSwiggy()
  const [snap, setSnap] = useState<{ nonce: string; cart: Cart } | null>(null)
  const [pay, setPay] = useState<PaymentOptions | null>(null)
  const [method, setMethod] = useState<Method | null>(null)
  const [stage, setStage] = useState<'loading' | 'review' | 'placing' | 'paying' | 'done'>('loading')
  const [err, setErr] = useState<string | null>(null)
  const [order, setOrder] = useState<PlacedOrder | null>(null)
  const stop = useRef(false)

  const load = async () => {
    setStage('loading'); setErr(null)
    try {
      const [s, p] = await Promise.all([api.confirmNonce(), api.paymentOptions()])
      setSnap(s); setPay(p); setStage('review')
    } catch (e) { setErr(explain(e)); setStage('review') }
  }
  useEffect(() => { load(); return () => { stop.current = true } }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const methods: Method[] = [
    ...(pay?.upi ?? []).map(u => ({ key: `upi:${u.id}`, label: `UPI · ${u.name}`, paymentMethod: 'UPI', intentApp: u.id })),
    ...(pay?.swiggyMoney ? [{ key: 'swiggypay', label: pay.swiggyMoney.name, paymentMethod: 'SwiggyPay' }] : []),
    ...(pay?.cod ? [{ key: 'cod', label: pay.cod.name, paymentMethod: 'COD' }] : [])
  ]

  /** Remember what was ordered so delivery can restock exact pack sizes. */
  const rememberOrder = (o: PlacedOrder, cart: Cart) => {
    const bySpin = new Map(Object.entries(kitchen.skuMap ?? {}).map(([id, s]) => [s.spinId, { id, s }]))
    const lines = cart.items.flatMap(i => { const m = bySpin.get(i.spinId); return m ? [{ id: m.id, packs: i.quantity, quantityDescription: m.s.quantityDescription }] : [] })
    updateKitchen(k => ({ ...k, pendingOrders: [...(k.pendingOrders ?? []), { orderId: o.orderId, at: Date.now(), total: cart.total, lines }] }))
  }

  const pollUpi = async (o: PlacedOrder) => {
    setStage('paying')
    const deadline = Date.now() + (o.maxTimeToPollForInMs ?? 300_000)
    while (!stop.current && Date.now() < deadline) {
      try {
        const { status: s } = await api.paymentStatus({ paasId: o.paasId!, orderId: o.orderId })
        if (s.terminal) {
          if (s.isTerminalSuccess) { await api.confirmOrder({ orderId: o.orderId, paasId: o.paasId!, transactionId: o.transactionId }); setStage('done'); toast('Payment received. Order placed.'); return }
          setErr('The UPI payment didn’t go through, so the order wasn’t placed.'); setStage('review'); return
        }
      } catch (e) { setErr(explain(e)) }
      await new Promise(r => setTimeout(r, Math.max(3000, o.pollingIntervalInMs ?? 5000)))
    }
    if (!stop.current) {
      await api.confirmOrder({ orderId: o.orderId, paasId: o.paasId!, transactionId: o.transactionId }).catch(() => {})
      setErr('Still waiting for the payment. Check the order in the Swiggy app.')
    }
  }

  const place = async () => {
    if (!snap || !method) return
    setStage('placing'); setErr(null)
    try {
      const { order: o } = await api.checkout({ nonce: snap.nonce, paymentMethod: method.paymentMethod, intentApp: method.intentApp })
      setOrder(o)
      rememberOrder(o, snap.cart)
      if (o.status === 'PENDING_PAYMENT' && o.paasId) return pollUpi(o)
      setStage('done'); toast('Order placed on Instamart')
    } catch (e) {
      setErr(explain(e))
      if (e instanceof ApiError && e.reason === 'stale') load()
      else setStage('review')
    }
  }

  const cart = snap?.cart
  return <div className="sheet-bg" onClick={e => { if (e.target === e.currentTarget && stage !== 'placing' && stage !== 'paying') onClose(stage === 'done') }}>
    <div className="sheet" role="dialog" aria-label="Place Instamart order">
      {stage === 'done' && order ? <>
        <h2 style={{ fontSize: 20 }}>Order placed</h2>
        <div className="sub">Order {order.orderId}. When it arrives, tap <b>Delivered</b> on the List tab to add everything to your pantry.</div>
        <button className="btn accent" onClick={() => onClose(true)}>{Icon.check}Done</button>
      </> : <>
        <h2 style={{ fontSize: 20 }}>Place this order on Instamart?</h2>
        {stage === 'loading' && <div className="sub"><span className="spin" /> Checking your cart and payment options…</div>}
        {cart && <>
          <div className="sub">{cart.items.length} items · deliver to <b>{status?.swiggy?.address?.label ?? cart.address?.label}</b></div>
          <div className="group">{cart.items.map(i => <div className="citem" key={i.spinId}><span className="pname">{i.name}<small>{i.variant} · ×{i.quantity}</small></span><span className="price">₹{i.price}</span></div>)}</div>
          <div className="totals">{cart.bill.map(b => <div key={b.label}><span>{b.label}</span><span className="price">{b.value}</span></div>)}
            <div className="grand"><span>To pay</span><span className="price">{cart.toPay}</span></div></div>
          <div>
            <div className="sub" style={{ marginBottom: 6 }}>Pay with</div>
            <div className="row">{methods.map(m => <button key={m.key} className="chip" aria-pressed={method?.key === m.key} onClick={() => setMethod(m)}>{m.label}</button>)}</div>
            {!methods.length && stage === 'review' && <div className="sub">Swiggy didn’t offer a payment method for this cart.</div>}
          </div>
          <div className="warn">Orders can’t be cancelled from here once placed.</div>
        </>}
        {stage === 'paying' && order?.upiIntentUrl && <a className="btn accent" href={order.upiIntentUrl}>Open your UPI app to pay</a>}
        {stage === 'paying' && <div className="sub"><span className="spin" /> Waiting for the payment to complete…</div>}
        {err && <div className="sub missing">{err}</div>}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn ghost" disabled={stage === 'placing' || stage === 'paying'} onClick={() => onClose()}>Cancel</button>
          {status?.ordering === false
            ? <span className="sub">Ordering is off on this server. Finish in the Swiggy app; the cart is already there.</span>
            : <button className="btn accent" disabled={!cart || !method || stage !== 'review'} onClick={place}>
                {stage === 'placing' ? <span className="spin" /> : Icon.check}Place order{cart ? ` · ${cart.toPay}` : ''}</button>}
        </div>
      </>}
    </div>
  </div>
}
