import { useState } from 'react'
import { api, type PastOrder } from '../../swiggy/api'
import { useSwiggy } from '../../swiggy/useSwiggy'
import { useApp } from '../AppContext'
import { ImportSheet, type ImportOrder } from './ImportSheet'

/** Pantry → recent Instamart orders that haven't been added to the pantry yet. */
export function OrdersSync() {
  const { kitchen, setTab } = useApp()
  const { ready, explain } = useSwiggy()
  const [orders, setOrders] = useState<PastOrder[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [importing, setImporting] = useState<ImportOrder[] | null>(null)
  const done = new Set(kitchen.importedOrders ?? [])

  const load = async () => {
    setBusy(true); setErr(null)
    try { setOrders((await api.orders()).orders) } catch (e) { setErr(explain(e)) } finally { setBusy(false) }
  }

  if (!ready) return <div className="card" style={{ marginTop: 12, background: 'var(--surface-2)', borderStyle: 'dashed' }}>
    <b style={{ fontSize: 13.5 }}>Sync from Instamart orders</b>
    <div className="sub">Connect Instamart in the <button className="linkbtn" onClick={() => setTab('my')}>My</button> tab and deliveries can be added here in one tap. Until then, cooking deducts what you used and ticking items off your list restocks them.</div>
  </div>

  const fresh = (orders ?? []).filter(o => !done.has(o.orderId) && !o.isActive && o.items.length)
  return <div className="card" style={{ marginTop: 12 }}>
    <div className="row" style={{ justifyContent: 'space-between' }}><b style={{ fontSize: 13.5 }}>Instamart orders</b>
      <button className="btn sm ghost" disabled={busy} onClick={load}>{busy ? <span className="spin" /> : null}{orders ? 'Refresh' : 'Check recent orders'}</button></div>
    {err && <div className="sub missing">{err}</div>}
    {orders && !fresh.length && <div className="sub">No delivered orders waiting to be added.</div>}
    {fresh.map(o => <div className="prow" key={o.orderId}>
      <span className="pname">{new Date(o.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} · ₹{o.total}
        <small>{o.items.slice(0, 4).map(i => i.name).join(', ')}{o.items.length > 4 ? ` +${o.items.length - 4} more` : ''}</small></span>
      <button className="btn sm accent" onClick={() => setImporting([{ orderId: o.orderId, label: new Date(o.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }), items: o.items }])}>Add</button>
    </div>)}
    {importing && <ImportSheet orders={importing} onClose={() => setImporting(null)} />}
  </div>
}
