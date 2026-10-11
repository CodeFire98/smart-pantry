import type { ReactNode } from 'react'
import { ENERGY, cookable, missing, type Evaluation, type Recipe } from '../engine'
import { usePhotoUrl } from '../store/hooks'
import { useApp } from './AppContext'
import { plateSVG } from './plate'

export const Icon = {
  cart: <svg viewBox="0 0 24 24"><path d="M3 4h2l2.4 11.2a1 1 0 0 0 1 .8h8.8a1 1 0 0 0 1-.8L20 8H6.2" /></svg>,
  check: <svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>,
  plus: <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>,
  cam: <svg viewBox="0 0 24 24" className="icon-cam"><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></svg>,
  copy: <svg viewBox="0 0 24 24"><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" /></svg>
}

export function Dots({ effort }: { effort: number }) {
  return <span className="dots" aria-label={`effort ${effort} of 3`}>{[1, 2, 3].map(i => <i key={i} className={i <= effort ? 'on' : ''} />)}</span>
}

/** Latest photo of a dish from the journal, if any. */
export function useCover(recipeId: string): number | undefined {
  const { journal } = useApp()
  return journal.find(j => j.recipeId === recipeId && j.photoId != null)?.photoId
}

export function Art({ recipe, photo = true }: { recipe: Recipe; photo?: boolean }) {
  const photoId = useCover(recipe.id)
  const url = usePhotoUrl(photo ? photoId : undefined)
  return url
    ? <div className="art"><img src={url} alt={`Your photo of ${recipe.name}`} /></div>
    : <div className="art" dangerouslySetInnerHTML={{ __html: plateSVG(recipe) }} />
}

export function WhyLine({ ev }: { ev: Evaluation }) {
  const pos = ev.terms.filter(t => t.points > 0 && !t.label.startsWith('Can make')).slice(0, 2)
  if (!pos.length) return null
  return <div className="why">{pos.map((t, i) => <span key={t.label}>{i > 0 && ' · '}{t.expiring ? <b>{t.label}</b> : t.label}</span>)}</div>
}

export function DishFoot({ ev }: { ev: Evaluation }) {
  const { addToList, name } = useApp()
  if (ev.group === 'now' && ev.upgrade && ev.upgrade.missing.length <= 3) {
    const m = ev.upgrade.missing
    return <div className="upgrade"><span>Add {m.map(name).join(', ')} for <b>{ev.recipe.tiers[ev.upgrade.tier].name}</b></span>
      <button className="btn sm ghost" onClick={() => addToList(m)}>{Icon.plus}Add {m.length}</button></div>
  }
  if (ev.group === 'away') return <div className="upgrade"><span>Missing <span className="missing">{ev.need.map(name).join(', ')}</span></span>
    <button className="btn sm accent" onClick={() => addToList(ev.need)}>{Icon.cart}Add to list</button></div>
  return null
}

export function DishCard({ ev }: { ev: Evaluation }) {
  const { openDish } = useApp()
  const r = ev.recipe, t = ev.cook >= 0 ? r.tiers[ev.cook] : r.tiers[0]
  return <div className="card">
    <button className="dish" onClick={() => openDish(r.id)}>
      <Art recipe={r} />
      <div className="dish-body">
        <div className="card-top"><span className="card-name">{r.name}</span><span className="score">{ev.score}</span></div>
        <div className="meta"><span className={`tierpill ${ev.group === 'now' ? '' : 'dim'}`}>{t.name}</span><span>{t.mins} min</span><Dots effort={t.effort} /></div>
        <WhyLine ev={ev} />
      </div>
    </button>
    <DishFoot ev={ev} />
  </div>
}

export function HeroCard({ ev }: { ev: Evaluation }) {
  const { openDish } = useApp()
  const r = ev.recipe, t = r.tiers[ev.cook]
  const foot = <DishFoot ev={ev} />
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
    <button className="hero" onClick={() => openDish(r.id)}>
      <Art recipe={r} />
      <div className="hero-body">
        <span className="eyebrow" style={{ color: 'var(--accent-ink)' }}>Top pick</span>
        <span className="card-name">{r.name}</span>
        <div className="meta"><span className="tierpill" style={{ background: 'var(--surface)' }}>{t.name}</span><span style={{ color: 'var(--ink)' }}>{t.mins} min</span><Dots effort={t.effort} /></div>
        <WhyLine ev={ev} />
      </div>
    </button>
    {ev.upgrade && ev.upgrade.missing.length <= 3 && <div className="card" style={{ padding: '10px 12px' }}>{foot}</div>}
  </div>
}

/** One-line state of a dish for search results: what's ready, or what's needed. */
export function ReadyLine({ recipe }: { recipe: Recipe }) {
  const { kitchen, catalog, addToList, name } = useApp()
  const ready = recipe.tiers.map((_, i) => (cookable(recipe, i, kitchen, catalog) ? i : -1)).filter(i => i >= 0)
  const best = ready.length ? Math.max(...ready) : -1
  if (best >= 0) {
    const t = recipe.tiers[best], next = best < recipe.tiers.length - 1 ? missing(recipe, best + 1, kitchen, catalog) : []
    return <>
      <div className="meta"><span className="tierpill">{t.name} ready</span><span>{t.mins} min</span><Dots effort={t.effort} /></div>
      {next.length > 0 && <div className="upgrade"><span>Add {next.map(name).join(', ')} for <b>{recipe.tiers[best + 1].name}</b></span>
        <button className="btn sm ghost" onClick={() => addToList(next)}>{Icon.plus}Add {next.length}</button></div>}
    </>
  }
  const m0 = missing(recipe, 0, kitchen, catalog)
  const price = m0.reduce((a, i) => a + (catalog[i]?.sku?.price ?? 0), 0)
  return <>
    <div className="meta"><span>Need for {recipe.tiers[0].name}:</span><span className="missing">{m0.map(name).join(', ')}</span></div>
    <div className="upgrade"><span>{m0.length} item{m0.length > 1 ? 's' : ''} · ≈ ₹{price}</span>
      <button className="btn sm accent" onClick={() => addToList(m0)}>{Icon.cart}Add to list</button></div>
  </>
}

export function Section({ title, sub, children }: { title: string; sub?: ReactNode; children: ReactNode }) {
  return <div className="section"><div className="section-head"><h2>{title}</h2>{sub && <span className="sub">{sub}</span>}</div>{children}</div>
}

export const energyLabel = (e: 1 | 2 | 3) => ENERGY[e].name
