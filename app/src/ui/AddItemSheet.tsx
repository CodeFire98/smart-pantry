import { useState } from 'react'
import type { Unit } from '../engine'
import { updateKitchen } from '../store/db'
import { useApp } from './AppContext'
import { Icon } from './components'

export const CATS: Record<string, string> = { fridge: 'Fridge', fresh: 'Fresh produce', freezer: 'Freezer', shelf: 'Grains & shelf', spices: 'Spices', sauces: 'Sauces & oils' }
const TRACK: { unit: Unit; label: string }[] = [{ unit: 'pc', label: 'Pieces' }, { unit: 'g', label: 'Grams' }, { unit: 'ml', label: 'ml' }, { unit: null, label: 'Level (full/half/low)' }]

const slug = (name: string) => 'my_' + name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40)

/** Add your own pantry item (can start at 0 as a placeholder), or edit/remove one you added. */
export function AddItemSheet({ editId, onClose }: { editId?: string; onClose: () => void }) {
  const { kitchen, catalog, toast } = useApp()
  const existing = editId ? kitchen.customIngredients?.[editId] : undefined
  const [name, setName] = useState(existing?.name ?? '')
  const [cat, setCat] = useState(existing?.cat ?? 'fridge')
  const [unit, setUnit] = useState<Unit>(existing ? existing.unit : 'pc')
  const [pack, setPack] = useState(existing?.pack ? String(existing.pack) : '')
  const [amount, setAmount] = useState(editId ? '' : '0')
  const [confirmRemove, setConfirmRemove] = useState(false)
  const id = editId ?? slug(name)
  const clash = !editId && !!name.trim() && (!!catalog[id] || Object.values(catalog).some(c => c.name.toLowerCase() === name.trim().toLowerCase()))
  const valid = name.trim().length > 1 && !clash && (pack === '' || Number(pack) > 0) && (editId || amount === '' || Number(amount) >= 0)

  const save = () => {
    const packN = pack ? Number(pack) : undefined
    updateKitchen(k => {
      const customIngredients = { ...k.customIngredients, [id]: { name: name.trim(), cat, unit, ...(packN ? { pack: packN } : {}) } }
      const items = { ...k.items }
      if (!editId) items[id] = unit ? { q: Number(amount || 0) } : { l: Number(amount) > 0 ? 3 : 0 }
      else if (existing && existing.unit !== unit) items[id] = unit ? { q: 0 } : { l: 0 }   // tracking changed: start fresh
      return { ...k, customIngredients, items }
    })
    toast(editId ? `${name.trim()} updated` : `${name.trim()} added to your pantry`)
    onClose()
  }
  const remove = () => {
    updateKitchen(k => {
      const { [id]: _c, ...customIngredients } = k.customIngredients ?? {}
      const { [id]: _i, ...items } = k.items
      return { ...k, customIngredients, items, list: k.list.filter(x => x !== id) }
    })
    toast(`${existing?.name} removed`)
    onClose()
  }

  return <div className="sheet-bg" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
    <form className="sheet" role="dialog" aria-label={editId ? 'Edit pantry item' : 'Add a pantry item'} onSubmit={e => { e.preventDefault(); if (valid) save() }}>
      <h2 style={{ fontSize: 20 }}>{editId ? 'Edit your item' : 'Add a pantry item'}</h2>
      <label className="field">Name
        <input id="item-name" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Coconut milk" autoFocus={!editId} disabled={!!editId} />
      </label>
      {clash && <div className="sub missing">You already have “{name.trim()}” in your pantry.</div>}
      <div><div className="sub" style={{ marginBottom: 6 }}>Where it lives</div>
        <div className="row">{Object.entries(CATS).map(([k, v]) => <button type="button" key={k} className="chip" aria-pressed={cat === k} onClick={() => setCat(k)}>{v}</button>)}</div></div>
      <div><div className="sub" style={{ marginBottom: 6 }}>Track it in</div>
        <div className="row">{TRACK.map(t => <button type="button" key={t.label} className="chip" aria-pressed={unit === t.unit} onClick={() => setUnit(t.unit)}>{t.label}</button>)}</div></div>
      {unit && unit !== 'pc' && <label className="field">Pack size you usually buy ({unit}) <span className="sub">optional, sets the +/− step</span>
        <input id="item-pack" inputMode="decimal" value={pack} onChange={e => setPack(e.target.value)} placeholder={unit === 'g' ? 'e.g. 500' : 'e.g. 400'} />
      </label>}
      {!editId && (unit
        ? <label className="field">How much you have now ({unit}) <span className="sub">0 if you're out</span>
            <input id="item-amount" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} />
          </label>
        : <div className="row"><span className="sub">Do you have it now?</span>
            <button type="button" className="chip" aria-pressed={amount !== '0'} onClick={() => setAmount('1')}>Yes</button>
            <button type="button" className="chip" aria-pressed={amount === '0'} onClick={() => setAmount('0')}>Not yet</button></div>)}
      {editId && <div className="row" style={{ justifyContent: 'flex-start' }}>
        {confirmRemove
          ? <><span className="sub missing">Remove {existing?.name}?</span>
              <button type="button" className="btn sm ghost" onClick={() => setConfirmRemove(false)}>Keep</button>
              <button type="button" className="btn sm" style={{ background: 'var(--miss)' }} onClick={remove}>Remove</button></>
          : <button type="button" className="linkbtn" style={{ color: 'var(--miss)' }} onClick={() => setConfirmRemove(true)}>Remove this item</button>}
      </div>}
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
        <button type="submit" className="btn accent" disabled={!valid}>{Icon.check}{editId ? 'Save' : 'Add to pantry'}</button>
      </div>
    </form>
  </div>
}
