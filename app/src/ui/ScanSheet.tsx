import { useState } from 'react'
import { addDays, restockAmounts, scanToRows, type Kitchen, type ScanRow } from '../engine'
import { ai, blobToB64 } from '../ai/api'
import { useAiContext } from '../ai/useAi'
import { updateKitchen } from '../store/db'
import { shrinkPhoto } from '../store/hooks'
import { useApp } from './AppContext'
import { Icon } from './components'

const slug = (s: string) => 'my_' + s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40)

/**
 * Scan a grocery bill (adds amounts) or a fridge/shelf photo (sets amounts for what's visible).
 * AI reads the photo; you review every line before anything changes.
 */
export function ScanSheet({ onClose }: { onClose: () => void }) {
  const { kitchen, catalog, ctx, toast } = useApp()
  const { context, explain } = useAiContext()
  const [kind, setKind] = useState<'bill' | 'shelf'>('bill')
  const [rows, setRows] = useState<ScanRow[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const ids = Object.keys(catalog).sort((a, b) => catalog[a].name.localeCompare(catalog[b].name))
  const set = (key: string, patch: Partial<ScanRow>) => setRows(rs => rs!.map(r => (r.key === key ? { ...r, ...patch } : r)))

  const read = async (f?: File) => {
    if (!f) return
    setBusy(true); setErr(null)
    try {
      const img = await blobToB64(await shrinkPhoto(f, 1280, 0.8))
      const { items } = await ai.scan(context(), kind, img)
      const r = scanToRows(items, kitchen, catalog)
      setRows(r)
      if (!r.length) setErr('No food items found in that photo. Try a clearer, closer shot.')
    } catch (e) { setErr(e instanceof Error && !('status' in e) ? 'That photo couldn’t be read. Try a JPEG or PNG.' : explain(e)) }
    finally { setBusy(false) }
  }

  const apply = () => {
    const chosen = rows!.filter(r => r.include && r.id)
    const fresh = chosen.filter(r => r.id === '__new')
    updateKitchen(k => {
      const customIngredients = { ...k.customIngredients }
      let out: Kitchen = { ...k, customIngredients, items: { ...k.items } }
      for (const r of fresh) {
        const id = slug(r.name)
        if (!catalog[id]) customIngredients[id] = { name: r.name, cat: 'fresh', unit: r.newUnit }
        out.items[id] = r.newUnit ? { q: r.amount ?? 0 } : { l: 3 }
      }
      const known = chosen.filter(r => r.id !== '__new')
      if (kind === 'bill') out = restockAmounts(known.map(r => ({ id: r.id, amount: catalog[r.id].unit ? r.amount : null })), out, catalog, ctx.today)
      else for (const r of known) {
        const ing = catalog[r.id], it = { ...out.items[r.id] }
        if (ing.unit) it.q = r.amount ?? it.q ?? 0; else it.l = 3
        delete it.unsure
        if (ing.kind === 'per' && ing.shelf > 0 && !it.exp) it.exp = addDays(ctx.today, ing.shelf)
        out.items[r.id] = it
      }
      return out
    })
    toast(`Pantry updated from your photo: ${chosen.length} item${chosen.length === 1 ? '' : 's'}`)
    onClose()
  }

  return <div className="sheet-bg" onClick={e => { if (e.target === e.currentTarget && !busy) onClose() }}>
    <div className="sheet" role="dialog" aria-label="Scan a photo">
      <div className="row" style={{ justifyContent: 'space-between' }}><h2 style={{ fontSize: 20 }}>📷 Scan a photo</h2><span className="sim">AI</span></div>
      {!rows && <>
        <div className="row">
          <button className="chip" aria-pressed={kind === 'bill'} onClick={() => setKind('bill')}>Grocery bill / delivery</button>
          <button className="chip" aria-pressed={kind === 'shelf'} onClick={() => setKind('shelf')}>Fridge or shelf</button>
        </div>
        <div className="sub">{kind === 'bill' ? 'Amounts on the bill are added to your pantry.' : 'Items you can see are set to the amounts in the photo.'} You check every line before anything changes.</div>
        <label className="photo-pick" htmlFor="scan-photo" style={{ minHeight: 120 }}>
          {busy ? <><span className="spin" /> Reading your photo…</> : <>{Icon.cam}Take or choose a photo</>}
          <input type="file" id="scan-photo" accept="image/*" disabled={busy} onChange={e => { read(e.target.files?.[0]); e.target.value = '' }} />
        </label>
      </>}
      {err && <div className="sub missing">{err}</div>}
      {rows && rows.length > 0 && <>
        <div className="sub">{kind === 'bill' ? 'Adding to your pantry.' : 'Setting amounts.'} Untick anything wrong or not food.</div>
        <div className="group">{rows.map(r => {
          const unit = r.id === '__new' ? r.newUnit : r.id ? catalog[r.id]?.unit : null
          return <div className="prow" key={r.key} style={{ alignItems: 'flex-start', flexDirection: 'column', gap: 6 }}>
            <label className="row" style={{ width: '100%' }}>
              <input type="checkbox" checked={r.include} onChange={e => set(r.key, { include: e.target.checked })} />
              <span className="pname" style={{ flex: 1 }}>{r.name}</span>
            </label>
            {r.include && <div className="row" style={{ paddingLeft: 24 }}>
              <select value={r.id} onChange={e => set(r.key, { id: e.target.value })} aria-label={`Pantry item for ${r.name}`}>
                <option value="">Choose item…</option>
                <option value="__new">+ Add “{r.name}” as a new item</option>
                {ids.map(id => <option key={id} value={id}>{catalog[id].name}</option>)}
              </select>
              {unit && <label className="row sub">{kind === 'bill' ? '+' : '='}<input type="number" min={0} className="num" value={r.amount ?? 0} onChange={e => set(r.key, { amount: Number(e.target.value) })} aria-label={`Amount of ${r.name}`} />{unit}</label>}
            </div>}
          </div>
        })}</div>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn ghost" onClick={() => setRows(null)}>Scan another</button>
          <button className="btn accent" disabled={!rows.some(r => r.include && r.id)} onClick={apply}>{Icon.check}Update pantry</button>
        </div>
      </>}
      {!rows && <button className="btn ghost" onClick={onClose} disabled={busy}>Close</button>}
    </div>
  </div>
}
