import { restock } from '../../engine'
import { updateKitchen } from '../../store/db'
import { useApp } from '../AppContext'
import { Icon } from '../components'

const instamartSearch = (q: string) => `https://www.swiggy.com/instamart/search?query=${encodeURIComponent(q)}`

export function List() {
  const { kitchen, catalog, ctx, toast } = useApp()
  const list = kitchen.list.filter(id => catalog[id])
  const total = list.reduce((a, i) => a + (catalog[i].sku?.price ?? 0), 0)

  const bought = (ids: string[]) => {
    updateKitchen(k => restock(ids, k, catalog, ctx.today))
    toast(ids.length === 1 ? `${catalog[ids[0]].name} restocked` : `Pantry restocked: ${ids.length} items`)
  }
  const copy = async () => {
    const text = list.map(i => `- ${catalog[i].sku?.name ?? catalog[i].name}`).join('\n')
    try { await navigator.clipboard.writeText(`Shopping list\n${text}`); toast('List copied') }
    catch { toast('Couldn’t copy. Select the items and copy them by hand.') }
  }

  if (!list.length) return <>
    <div className="eyebrow">Instamart</div><h1>Shopping list</h1>
    <div className="section"><div className="empty">Your list is empty. Missing ingredients you add from a dish land here.</div></div>
  </>

  return <>
    <div className="eyebrow">Instamart · sample prices</div>
    <h1>Shopping list</h1>
    <div className="section">
      <div className="group">{list.map(i => {
        const ing = catalog[i], s = ing.sku
        return <div className="citem" key={i}>
          <span className="pname">{ing.name}
            <small>{s ? `${s.name} · ${s.pack} ${ing.unit ?? (s.pack >= 100 ? 'g' : 'pc')} · ₹${s.price}` : 'pick on Instamart'} · <a className="linkbtn" href={instamartSearch(s?.name ?? ing.name)} target="_blank" rel="noreferrer">Search on Instamart</a></small></span>
          <span className="row" style={{ flex: 'none' }}>
            <button className="btn sm ghost" onClick={() => bought([i])} aria-label={`Mark ${ing.name} bought`}>{Icon.check}Got it</button>
            <button className="x" onClick={() => updateKitchen(k => ({ ...k, list: k.list.filter(x => x !== i) }))} aria-label={`Remove ${ing.name}`}>×</button>
          </span>
        </div>
      })}</div>
      <div className="totals"><div className="grand"><span>Estimated total ({list.length})</span><span className="price">₹{total}</span></div></div>
      <div className="row">
        <button className="btn ghost" style={{ flex: 1 }} onClick={copy}>{Icon.copy}Copy list</button>
        <button className="btn accent" style={{ flex: 1 }} onClick={() => bought(list)}>{Icon.check}Got everything</button>
      </div>
      <p className="sub">“Got it” adds one pack to your pantry with a fresh expiry date. In Phase 2 this list becomes a real Instamart cart: live prices and stock from search_products, then checkout after your confirmation.</p>
    </div>
  </>
}
