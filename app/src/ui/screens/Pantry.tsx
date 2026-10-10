import { addDays, daysBetween, type PantryItem } from '../../engine'
import { resetKitchen, updateKitchen } from '../../store/db'
import { useApp } from '../AppContext'
import { Section } from '../components'

const CATS: Record<string, string> = { fridge: 'Fridge', fresh: 'Fresh produce', freezer: 'Freezer', shelf: 'Grains & shelf', spices: 'Spices', sauces: 'Sauces & oils' }
const LEVELS = ['Out', 'Low', 'Half', 'Full']
const EQUIPMENT = ['kadai', 'saucepan', 'induction', 'blender', 'microwave', 'pressure cooker', 'oven']
const STEP: Record<string, number> = { g: 50, ml: 100, pc: 1 }

export function Pantry() {
  const { kitchen, catalog, ctx, toast } = useApp()
  const ids = Object.keys(catalog).filter(id => kitchen.items[id] || catalog[id].kind !== 'stp' || catalog[id].sku)
  const amount = (id: string) => { const it = kitchen.items[id]; return it ? (catalog[id].unit ? it.q ?? 0 : it.l ?? 0) : 0 }
  const days = (id: string) => { const e = kitchen.items[id]?.exp; return e ? daysBetween(ctx.today, e) : null }
  const unsure = ids.filter(i => kitchen.items[i]?.unsure)
  const soon = ids.filter(i => amount(i) > 0 && (days(i) ?? 99) <= 2).length

  const edit = (id: string, fn: (it: PantryItem) => void) => updateKitchen(k => { const it = (k.items[id] ??= {}); fn(it); return k })
  const stepQty = (id: string, dir: 1 | -1) => edit(id, it => {
    const ing = catalog[id]
    const step = ing.unit === 'g' && (ing.sku?.pack ?? 0) >= 1000 ? 250 : STEP[ing.unit!] ?? 1
    it.q = Math.max(0, (it.q ?? 0) + step * dir)
    if (dir > 0 && ing.kind === 'per' && ing.shelf > 0 && (!it.exp || daysBetween(ctx.today, it.exp) < 1)) it.exp = addDays(ctx.today, ing.shelf)
  })

  const Row = ({ id }: { id: string }) => {
    const it = kitchen.items[id] ?? {}, ing = catalog[id], q = amount(id), d = days(id)
    const kind = ing.kind === 'stp' ? 'staple · stays stocked until you mark it out' : ing.unit ? `tracked in ${ing.unit === 'pc' ? 'pieces' : ing.unit}` : 'tracked by level'
    return <div className="prow">
      <span className="pname">{ing.name}
        {q > 0 && d != null && d <= 3 && <span className={`exp ${d <= 1 ? 'hot' : ''}`}>{d <= 0 ? 'use today' : d === 1 ? 'tomorrow' : `${d} days`}</span>}
        <small>{it.unsure ? 'you weren’t sure — still have it?' : kind}</small></span>
      {it.unsure
        ? <span className="yesno">
            <button className="btn sm ghost" onClick={() => edit(id, x => { delete x.unsure })}>Have it</button>
            <button className="btn sm ghost" onClick={() => edit(id, x => { delete x.unsure; if (ing.unit) x.q = 0; else x.l = 0 })}>Out</button></span>
        : ing.unit
          ? <span className="stepper">
              <button onClick={() => stepQty(id, -1)} aria-label={`Less ${ing.name}`}>−</button>
              <output className={q === 0 ? 'zero' : ''}>{q === 0 ? 'out' : ing.unit === 'pc' ? q : `${q} ${ing.unit}`}</output>
              <button onClick={() => stepQty(id, 1)} aria-label={`More ${ing.name}`}>+</button></span>
          : <button className="level" onClick={() => edit(id, x => { const l = x.l ?? 0; x.l = l === 0 ? 3 : l - 1 })} aria-label={`${ing.name}: ${LEVELS[q]}. Tap to change`}>
              <span className={`bars l${q}`}><i /><i /><i /></span><span className="lvtext">{LEVELS[q]}</span></button>}
    </div>
  }

  return <>
    <div className="eyebrow">What's in the kitchen</div>
    <h1>Pantry</h1>
    <div className="stats">
      <div className="stat"><b>{ids.filter(i => amount(i) > 0).length}</b><span>in stock</span></div>
      <div className="stat"><b style={{ color: 'var(--low)' }}>{soon}</b><span>use in 2 days</span></div>
      <div className="stat"><b style={{ color: 'var(--miss)' }}>{ids.filter(i => amount(i) === 0).length}</b><span>out</span></div>
    </div>
    <div className="card" style={{ marginTop: 12, background: 'var(--surface-2)', borderStyle: 'dashed' }}>
      <div className="row" style={{ justifyContent: 'space-between' }}><b style={{ fontSize: 13.5 }}>Sync from Instamart orders</b><span className="sim">Phase 2</span></div>
      <div className="sub">Once Swiggy access is set up, deliveries land here automatically. Until then, cooking a dish deducts what it used, and ticking items off your list restocks them.</div>
    </div>
    {unsure.length > 0 && <Section title="Still have these?" sub={`${unsure.length} to confirm`}><div className="group">{unsure.map(id => <Row key={id} id={id} />)}</div></Section>}
    {Object.entries(CATS).map(([c, label]) => {
      const rows = ids.filter(i => catalog[i].cat === c && !kitchen.items[i]?.unsure)
        .sort((a, b) => Number(amount(b) > 0) - Number(amount(a) > 0) || (days(a) ?? 99) - (days(b) ?? 99) || catalog[a].name.localeCompare(catalog[b].name))
      if (!rows.length) return null
      return <Section key={c} title={label} sub={`${rows.filter(i => amount(i) > 0).length} of ${rows.length} in stock`}>
        <div className="group">{rows.map(id => <Row key={id} id={id} />)}</div></Section>
    })}
    <Section title="Kitchen equipment" sub="versions needing gear you don't have are skipped">
      <div className="row">{EQUIPMENT.map(e => <button key={e} className="toggle" aria-pressed={kitchen.equipment.includes(e)}
        onClick={() => updateKitchen(k => ({ ...k, equipment: k.equipment.includes(e) ? k.equipment.filter(x => x !== e) : [...k.equipment, e] }))}>{e}</button>)}</div>
    </Section>
    <div className="row" style={{ marginTop: 24, justifyContent: 'center' }}>
      <ResetButton onReset={() => { resetKitchen(); toast('Pantry reset to your starting list') }} />
    </div>
  </>
}

function ResetButton({ onReset }: { onReset: () => void }) {
  return <details className="sub" style={{ textAlign: 'center' }}>
    <summary style={{ cursor: 'pointer' }}>Reset pantry…</summary>
    <p>This replaces every amount with your starting list from data/pantry.json. Your journal stays.</p>
    <button className="btn sm ghost" onClick={onReset}>Reset to my starting pantry</button>
  </details>
}
