import { useState } from 'react'
import { logActivity } from '../../store/activity'
import { matchOrderItem, packAmount, restockAmounts } from '../../engine'
import { updateKitchen } from '../../store/db'
import { useApp } from '../AppContext'

/** An order line to add. `id` + `quantityDescription` are known exactly for orders placed from this app. */
export interface ImportOrder { orderId: string; label: string; items: { name: string; quantity: number; itemId?: string | null; id?: string; quantityDescription?: string }[] }

interface Row { key: string; name: string; packs: number; id: string; amount: number | null; include: boolean }

/**
 * Review delivered items before they go into the pantry: each line is matched to an ingredient
 * (a product you picked, or by name). You can change the match or amount, or skip a line.
 */
export function ImportSheet({ orders, onClose }: { orders: ImportOrder[]; onClose: () => void }) {
  const { kitchen, catalog, ctx, toast } = useApp()
  const [rows, setRows] = useState<Row[]>(() => orders.flatMap(o => o.items.map((it, i) => {
    const m = it.id && catalog[it.id] ? { id: it.id } : matchOrderItem(it.name, kitchen, catalog, it.itemId)
    const pick = m ? kitchen.skuMap?.[m.id] : undefined
    const desc = it.quantityDescription ?? (pick?.name.toLowerCase() === it.name.toLowerCase() ? pick.quantityDescription : it.name)
    const per = m ? packAmount(m.id, desc, catalog) : null
    return { key: `${o.orderId}:${i}`, name: it.name, packs: it.quantity, id: m?.id ?? '', amount: per != null ? per * it.quantity : null, include: !!m }
  })))
  const ids = Object.keys(catalog).sort((a, b) => catalog[a].name.localeCompare(catalog[b].name))
  const set = (key: string, patch: Partial<Row>) => setRows(rs => rs.map(r => (r.key === key ? { ...r, ...patch } : r)))

  const apply = () => {
    const lines = rows.filter(r => r.include && r.id).map(r => ({ id: r.id, amount: catalog[r.id].unit ? r.amount : null }))
    updateKitchen(k => {
      const done = new Set(orders.map(o => o.orderId))
      const out = restockAmounts(lines, k, catalog, ctx.today)
      return { ...out, importedOrders: [...new Set([...(k.importedOrders ?? []), ...done])], pendingOrders: (k.pendingOrders ?? []).filter(p => !done.has(p.orderId)) }
    })
    toast(`Pantry updated: ${lines.length} item${lines.length === 1 ? '' : 's'}`)
    logActivity({ type: 'restock', names: lines.map(l => catalog[l.id]?.name ?? l.id) })
    onClose()
  }

  return <div className="sheet-bg" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
    <div className="sheet" role="dialog" aria-label="Add delivered items to the pantry">
      <div><div className="eyebrow">{orders.map(o => o.label).join(' · ')}</div><h2 style={{ fontSize: 20 }}>Add to pantry</h2></div>
      <div className="sub">Check each match. Untick anything that isn’t food for the pantry.</div>
      <div className="group">{rows.map(r => {
        const unit = r.id ? catalog[r.id]?.unit : null
        return <div className="prow" key={r.key} style={{ alignItems: 'flex-start', flexDirection: 'column', gap: 6 }}>
          <label className="row" style={{ width: '100%' }}>
            <input type="checkbox" checked={r.include} onChange={e => set(r.key, { include: e.target.checked })} />
            <span className="pname" style={{ flex: 1 }}>{r.name}<small>×{r.packs} from Instamart</small></span>
          </label>
          {r.include && <div className="row" style={{ paddingLeft: 24 }}>
            <select value={r.id} onChange={e => { const id = e.target.value; set(r.key, { id, amount: packAmount(id, r.name, catalog) != null ? packAmount(id, r.name, catalog)! * r.packs : null }) }} aria-label={`Ingredient for ${r.name}`}>
              <option value="">Choose ingredient…</option>
              {ids.map(id => <option key={id} value={id}>{catalog[id].name}</option>)}
            </select>
            {unit && <label className="row sub">+<input type="number" min={0} step={unit === 'pc' ? 1 : 50} value={r.amount ?? 0} onChange={e => set(r.key, { amount: Number(e.target.value) })} className="num" aria-label={`Amount of ${r.name}`} />{unit}</label>}
          </div>}
        </div>
      })}</div>
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn accent" disabled={!rows.some(r => r.include && r.id)} onClick={apply}>Add to pantry</button>
      </div>
    </div>
  </div>
}
