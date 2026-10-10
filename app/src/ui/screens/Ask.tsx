import { useState } from 'react'
import { interpret, rank } from '../../engine'
import { useApp } from '../AppContext'
import { Art, ReadyLine } from '../components'

const EXAMPLES = ['spicy and quick', 'paneer', 'eggs', 'comfort', 'dal', 'rajma chawal']

export function Ask() {
  const { recipes, catalog, ctx, query, setQuery, openDish, setTab } = useApp()
  const [draft, setDraft] = useState(query)
  const it = interpret(query, recipes, catalog)
  const results = it ? rank(it.results, ctx) : []

  return <>
    <div className="eyebrow">Not feeling the suggestions?</div>
    <h1>What do you want to eat?</h1>
    <form className="askbox" onSubmit={e => { e.preventDefault(); setQuery(draft) }}>
      <input id="ask" value={draft} onChange={e => setDraft(e.target.value)} placeholder="e.g. paneer, something spicy, dal" autoComplete="off" aria-label="What do you want to eat" />
      <button className="btn accent" type="submit">Find</button>
    </form>
    <div className="row" style={{ marginTop: 10 }}>{EXAMPLES.map(x =>
      <button key={x} className="chip" onClick={() => { setDraft(x); setQuery(x) }}>{x}</button>)}</div>
    <div className="section">
      {!it && <div className="empty">Type a dish, an ingredient or a mood. You'll see what you can make now, and what you'd need to buy for each version.</div>}
      {it && <div className="parsed">Understood as {[
        ...it.dishes.map(d => <code key={d.id}>dish: {d.name}</code>),
        ...it.tags.map(t => <code key={t}>mood: {t}</code>),
        ...it.ingredients.map(i => <code key={i}>uses: {catalog[i].name.toLowerCase()}</code>)
      ].concat(it.dishes.length + it.tags.length + it.ingredients.length ? [] : [<code key="none">nothing recognised</code>])}</div>}
      {results.map(ev => <div className="card" key={ev.recipe.id}>
        <button className="dish" onClick={() => openDish(ev.recipe.id)}><Art recipe={ev.recipe} /><div className="dish-body"><span className="card-name">{ev.recipe.name}</span></div></button>
        <ReadyLine recipe={ev.recipe} />
      </div>)}
      {it && !results.length && <div className="empty">
        None of your dishes match “{it.text}”. New recipes can be drafted with the prototype's AI button and imported from the <button className="linkbtn" onClick={() => setTab('my')}>My</button> tab. Built-in AI drafting arrives in Phase 3.
      </div>}
    </div>
  </>
}
