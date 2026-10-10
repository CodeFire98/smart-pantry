import { useEffect, useState } from 'react'
import { updateKitchen } from '../../store/db'
import { api, type Product, type Variation } from '../../swiggy/api'
import { useSwiggy } from '../../swiggy/useSwiggy'
import { useApp } from '../AppContext'

/** Search Instamart for one ingredient and remember the pack you pick. */
export function ProductPicker({ id, onClose }: { id: string; onClose: () => void }) {
  const { catalog, toast } = useApp()
  const { explain } = useSwiggy()
  const ing = catalog[id]
  const [query, setQuery] = useState(ing.sku?.name ?? ing.name)
  const [results, setResults] = useState<Product[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const search = async (q = query) => {
    setBusy(true); setErr(null)
    try { setResults((await api.search(q)).products) } catch (e) { setErr(explain(e)) } finally { setBusy(false) }
  }
  useEffect(() => { search() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (v: Variation, p: Product) => {
    updateKitchen(k => ({
      ...k,
      skuMap: { ...k.skuMap, [id]: { spinId: v.spinId, skuId: v.skuId, name: v.name || p.name, quantityDescription: v.quantityDescription, price: v.price, imageUrl: v.imageUrl, qty: k.skuMap?.[id]?.qty ?? 1 } }
    }))
    toast(`${ing.name}: ${v.name || p.name} · ${v.quantityDescription}`)
    onClose()
  }

  return <div className="sheet-bg" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
    <div className="sheet" role="dialog" aria-label={`Pick a product for ${ing.name}`}>
      <div><div className="eyebrow">Instamart product for</div><h2 style={{ fontSize: 20 }}>{ing.name}</h2></div>
      <form className="askbox" style={{ marginTop: 0 }} onSubmit={e => { e.preventDefault(); search() }}>
        <input id="product-search" value={query} onChange={e => setQuery(e.target.value)} aria-label="Search Instamart" />
        <button className="btn ghost" disabled={busy}>Search</button>
      </form>
      {busy && <div className="sub"><span className="spin" /> Searching Instamart…</div>}
      {err && <div className="sub missing">{err}</div>}
      {results && !results.length && !busy && <div className="empty">No products found. Try a simpler search, like “{ing.name.split(' ')[0]}”.</div>}
      <div className="group">{results?.flatMap(p => p.variations.map(v =>
        <div className="prod" key={v.spinId}>
          {v.imageUrl ? <img src={v.imageUrl} alt="" loading="lazy" /> : <span className="prod-ph" />}
          <span className="pname">{v.name || p.name}<small>{p.brand && `${p.brand} · `}{v.quantityDescription}{!v.inStock && ' · out of stock'}</small></span>
          <span className="row" style={{ flex: 'none' }}>
            <span className="price">₹{v.price}</span>
            <button className="btn sm accent" disabled={!v.inStock} onClick={() => pick(v, p)}>Pick</button>
          </span>
        </div>))}</div>
      <button className="btn ghost" onClick={onClose}>Close</button>
    </div>
  </div>
}
