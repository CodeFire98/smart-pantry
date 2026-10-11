import { useState } from 'react'
import { addDays, daysBetween, stepFor, type Catalog, type Kitchen, type PantryItem } from '../../engine'
import { resetKitchen, updateKitchen } from '../../store/db'
import { useApp } from '../AppContext'
import { Icon, Section } from '../components'
import { AddItemSheet, CATS } from '../AddItemSheet'
import { OrdersSync } from '../swiggy/OrdersSync'

const LEVELS = ['Out', 'Low', 'Half', 'Full']
const EQUIPMENT = ['kadai', 'saucepan', 'induction', 'blender', 'microwave', 'pressure cooker', 'oven']

const editItem = (id: string, fn: (it: PantryItem) => void) => updateKitchen(k => { const it = (k.items[id] ??= {}); fn(it); return k })

/** Set a quantity; topping up a perishable that was out or expired gives it a fresh expiry date. */
function setQty(id: string, q: number, catalog: Catalog, today: string) {
  return editItem(id, it => {
    const ing = catalog[id], before = it.q ?? 0
    it.q = Math.max(0, Math.round(q * 100) / 100)
    if (it.q > before && ing.kind === 'per' && ing.shelf > 0 && (!it.exp || before === 0 || daysBetween(today, it.exp) < 1)) it.exp = addDays(today, ing.shelf)
  })
}

const fmt = (q: number, unit: string | null) => (unit === 'pc' ? `${q}` : q >= 1000 && (unit === 'g' || unit === 'ml') ? `${q / 1000} ${unit === 'g' ? 'kg' : 'L'}` : `${q} ${unit}`)

function PantryRow({ id, kitchen, catalog, today, onEditCustom }: { id: string; kitchen: Kitchen; catalog: Catalog; today: string; onEditCustom: (id: string) => void }) {
  const { addToList } = useApp()
  const [typing, setTyping] = useState<string | null>(null)
  const it = kitchen.items[id] ?? {}, ing = catalog[id]
  const q = ing.unit ? it.q ?? 0 : it.l ?? 0
  const d = it.exp ? daysBetween(today, it.exp) : null
  const custom = !!kitchen.customIngredients?.[id]
  const step = stepFor(id, catalog)
  const onList = kitchen.list.includes(id)
  const kind = ing.kind === 'stp' ? 'staple · stays stocked until you mark it out' : ing.unit ? `± ${fmt(step, ing.unit)}${ing.unit === 'pc' ? ' at a time' : ''}` : 'tracked by level'
  const commit = () => { if (typing != null && typing.trim() !== '' && !isNaN(Number(typing))) setQty(id, Number(typing), catalog, today); setTyping(null) }

  return <div className="prow">
    <span className="pname">
      {custom ? <button className="linkbtn plain" onClick={() => onEditCustom(id)}>{ing.name}</button> : ing.name}
      {q > 0 && d != null && d <= 3 && <span className={`exp ${d <= 1 ? 'hot' : ''}`}>{d <= 0 ? 'use today' : d === 1 ? 'tomorrow' : `${d} days`}</span>}
      <small>{it.unsure ? 'you weren’t sure, still have it?' : custom ? `added by you · ${kind}` : kind}
        {q === 0 && !it.unsure && (onList ? ' · on your list' : <> · <button className="linkbtn" onClick={() => addToList([id])}>+ List</button></>)}</small>
    </span>
    {it.unsure
      ? <span className="yesno">
          <button className="btn sm ghost" onClick={() => editItem(id, x => { delete x.unsure })}>Have it</button>
          <button className="btn sm ghost" onClick={() => editItem(id, x => { delete x.unsure; if (ing.unit) x.q = 0; else x.l = 0 })}>Out</button></span>
      : ing.unit
        ? <span className="stepper">
            <button onClick={() => setQty(id, q - step, catalog, today)} aria-label={`${fmt(step, ing.unit)} less ${ing.name}`}>−</button>
            {typing != null
              ? <input className="qty-input" autoFocus inputMode="decimal" value={typing} onChange={e => setTyping(e.target.value)} onBlur={commit}
                  onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setTyping(null) }} aria-label={`Amount of ${ing.name} in ${ing.unit}`} />
              : <output className={q === 0 ? 'zero' : ''} onClick={() => setTyping(String(q))} title="Tap to type an exact amount" role="button" tabIndex={0}
                  onKeyDown={e => { if (e.key === 'Enter') setTyping(String(q)) }}>{q === 0 ? 'out' : fmt(q, ing.unit)}</output>}
            <button onClick={() => setQty(id, q + step, catalog, today)} aria-label={`${fmt(step, ing.unit)} more ${ing.name}`}>+</button></span>
        : <button className="level" onClick={() => editItem(id, x => { const l = x.l ?? 0; x.l = l === 0 ? 3 : l - 1 })} aria-label={`${ing.name}: ${LEVELS[q]}. Tap to change`}>
            <span className={`bars l${q}`}><i /><i /><i /></span><span className="lvtext">{LEVELS[q]}</span></button>}
  </div>
}

export function Pantry() {
  const { kitchen, catalog, ctx, toast } = useApp()
  const [sheet, setSheet] = useState<{ edit?: string } | null>(null)
  const ids = Object.keys(catalog).filter(id => kitchen.items[id] || catalog[id].kind !== 'stp' || catalog[id].sku)
  const amount = (id: string) => { const it = kitchen.items[id]; return it ? (catalog[id].unit ? it.q ?? 0 : it.l ?? 0) : 0 }
  const days = (id: string) => { const e = kitchen.items[id]?.exp; return e ? daysBetween(ctx.today, e) : null }
  const unsure = ids.filter(i => kitchen.items[i]?.unsure)
  const soon = ids.filter(i => amount(i) > 0 && (days(i) ?? 99) <= 2).length
  const row = (id: string) => <PantryRow key={id} id={id} kitchen={kitchen} catalog={catalog} today={ctx.today} onEditCustom={x => setSheet({ edit: x })} />

  return <>
    <div className="eyebrow">What's in the kitchen</div>
    <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-end' }}>
      <h1>Pantry</h1>
      <button className="btn sm accent" onClick={() => setSheet({})}>{Icon.plus}Add item</button>
    </div>
    <div className="stats">
      <div className="stat"><b>{ids.filter(i => amount(i) > 0).length}</b><span>in stock</span></div>
      <div className="stat"><b style={{ color: 'var(--low)' }}>{soon}</b><span>use in 2 days</span></div>
      <div className="stat"><b style={{ color: 'var(--miss)' }}>{ids.filter(i => amount(i) === 0).length}</b><span>out</span></div>
    </div>
    <OrdersSync />
    {unsure.length > 0 && <Section title="Still have these?" sub={`${unsure.length} to confirm`}><div className="group">{unsure.map(row)}</div></Section>}
    {Object.entries(CATS).map(([c, label]) => {
      const rows = ids.filter(i => catalog[i].cat === c && !kitchen.items[i]?.unsure)
        .sort((a, b) => Number(amount(b) > 0) - Number(amount(a) > 0) || (days(a) ?? 99) - (days(b) ?? 99) || catalog[a].name.localeCompare(catalog[b].name))
      if (!rows.length) return null
      return <Section key={c} title={label} sub={`${rows.filter(i => amount(i) > 0).length} of ${rows.length} in stock`}>
        <div className="group">{rows.map(row)}</div></Section>
    })}
    <p className="sub" style={{ textAlign: 'center', marginTop: 12 }}>Tap an amount to type it exactly.</p>
    <Section title="Kitchen equipment" sub="versions needing gear you don't have are skipped">
      <div className="row">{EQUIPMENT.map(e => <button key={e} className="toggle" aria-pressed={kitchen.equipment.includes(e)}
        onClick={() => updateKitchen(k => ({ ...k, equipment: k.equipment.includes(e) ? k.equipment.filter(x => x !== e) : [...k.equipment, e] }))}>{e}</button>)}</div>
    </Section>
    <div className="row" style={{ marginTop: 24, justifyContent: 'center' }}>
      <ResetButton onReset={() => { resetKitchen(); toast('Pantry reset to your starting list') }} />
    </div>
    {sheet && <AddItemSheet editId={sheet.edit} onClose={() => setSheet(null)} />}
  </>
}

function ResetButton({ onReset }: { onReset: () => void }) {
  return <details className="sub" style={{ textAlign: 'center' }}>
    <summary style={{ cursor: 'pointer' }}>Reset pantry…</summary>
    <p>This replaces every amount with your starting list from data/pantry.json. Your journal and the items you added stay.</p>
    <button className="btn sm ghost" onClick={onReset}>Reset to my starting pantry</button>
  </details>
}
