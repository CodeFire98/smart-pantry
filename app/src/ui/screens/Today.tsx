import { daysBetween, rank, type Energy, type Meal } from '../../engine'
import { useApp } from '../AppContext'
import { DishCard, HeroCard, energyLabel } from '../components'

const MEALS: Meal[] = ['breakfast', 'lunch', 'snack', 'dinner']
const MOODS = ['spicy', 'comfort', 'protein', 'light', 'indo-chinese', 'chicken']

export function Today() {
  const { recipes, ctx, meal, setMeal, energy, setEnergy, moods, toggleMood, kitchen, catalog } = useApp()
  const all = rank(recipes, ctx)
  const now = all.filter(e => e.group === 'now'), away = all.filter(e => e.group === 'away')
  const hr = new Date().getHours()
  const greet = hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening'
  const soon = Object.entries(kitchen.items)
    .map(([id, v]) => ({ id, d: v.exp ? daysBetween(ctx.today, v.exp) : null, has: (v.q ?? v.l ?? 0) > 0 }))
    .filter(x => x.d != null && x.d <= 3 && x.has && catalog[x.id])
    .sort((a, b) => a.d! - b.d!)

  return <>
    <div className="eyebrow">{greet} · {new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' })}</div>
    <h1>You can cook <em>{now.length} dish{now.length === 1 ? '' : 'es'}</em> for {meal} right now</h1>
    {soon.length > 0 && <div className="soon" aria-label="Use soon">{soon.map(x =>
      <span key={x.id} className={x.d! <= 1 ? 'hot' : ''}>{catalog[x.id].name} · {x.d! <= 0 ? 'today' : x.d === 1 ? 'tomorrow' : `${x.d} days`}</span>)}</div>}
    <div className="controls">
      <div className="row"><span className="lbl">Meal</span>{MEALS.map(m =>
        <button key={m} className="chip" aria-pressed={meal === m} onClick={() => setMeal(m)}>{m[0].toUpperCase() + m.slice(1)}</button>)}</div>
      <div className="row"><span className="lbl">Energy</span>
        <div className="seg">{([1, 2, 3] as Energy[]).map(e => <button key={e} aria-pressed={energy === e} onClick={() => setEnergy(e)}>{energyLabel(e)}</button>)}</div>
        <span className="sub">{energy === 1 ? '≤15 min' : energy === 2 ? '≤30 min' : 'any'}</span></div>
      <div className="row"><span className="lbl">Mood</span>{MOODS.map(m =>
        <button key={m} className="chip" aria-pressed={moods.includes(m)} onClick={() => toggleMood(m)}>{m}</button>)}</div>
    </div>
    <div className="section">
      {now.length > 0 && <HeroCard ev={now[0]} />}
      <div className="section-head" style={{ marginTop: 6 }}><h2>Cook now</h2><span className="sub">best version you can make</span></div>
      {now.length > 1 ? now.slice(1).map(ev => <DishCard key={ev.recipe.id} ev={ev} />)
        : now.length === 0 && <div className="empty">Nothing is fully stocked at this energy level. Try more energy, or check “One trip away”.</div>}
    </div>
    <div className="section">
      <div className="section-head"><h2>One trip away</h2><span className="sub">1–2 items short</span></div>
      {away.length ? away.map(ev => <DishCard key={ev.recipe.id} ev={ev} />) : <div className="empty">No near-misses right now.</div>}
    </div>
  </>
}
