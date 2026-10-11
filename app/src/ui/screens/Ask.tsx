import { useState } from 'react'
import { applyAiFilters, interpret, normalizeDraft, rank, type AiFilters, type Draft } from '../../engine'
import { ai } from '../../ai/api'
import { useAiContext } from '../../ai/useAi'
import { RecipeEditor } from '../recipes/RecipeEditor'
import { useApp } from '../AppContext'
import { Art, ReadyLine } from '../components'

const EXAMPLES = ['spicy and quick', 'paneer', 'eggs', 'comfort', 'dal', 'rajma chawal']

export function Ask() {
  const { recipes, hiddenRecipes, catalog, ctx, query, setQuery, openDish } = useApp()
  const [draft, setDraft] = useState(query)
  const { context, explain } = useAiContext()
  const [aiUnderstood, setAiUnderstood] = useState<{ q: string; f: AiFilters } | null>(null)
  const [aiBusy, setAiBusy] = useState<'parse' | 'draft' | null>(null)
  const [aiErr, setAiErr] = useState<string | null>(null)
  const [written, setWritten] = useState<Draft | null>(null)
  const it = interpret(query, recipes, catalog)
  const recognised = !!it && (it.dishes.length + it.tags.length + it.ingredients.length > 0)
  const aiResults = aiUnderstood && aiUnderstood.q === query ? applyAiFilters(aiUnderstood.f, recipes, catalog) : []
  const results = it ? rank(recognised ? it.results : aiResults, ctx) : []
  const allTags = [...new Set(recipes.flatMap(r => r.tags))]

  const understand = async () => {
    setAiBusy('parse'); setAiErr(null)
    try { setAiUnderstood({ q: query, f: (await ai.parse(context(), query, allTags)).filters }) } catch (e) { setAiErr(explain(e)) } finally { setAiBusy(null) }
  }
  const write = async () => {
    setAiBusy('draft'); setAiErr(null)
    try {
      const d = normalizeDraft((await ai.draft(context(), query)).recipe, catalog, new Set([...recipes, ...hiddenRecipes].map(r => r.id)))
      if (d) setWritten(d); else setAiErr('The AI’s recipe didn’t come back in a usable form. Try again.')
    } catch (e) { setAiErr(explain(e)) } finally { setAiBusy(null) }
  }

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
      {it && !recognised && aiUnderstood?.q === query && <div className="parsed">✨ Understood with AI as <code>{aiUnderstood.f.summary || 'filters'}</code>
        {aiUnderstood.f.maxMins ? <code>≤ {aiUnderstood.f.maxMins} min</code> : null}</div>}
      {it && (recognised || aiUnderstood?.q !== query) && <div className="parsed">Understood as {[
        ...it.dishes.map(d => <code key={d.id}>dish: {d.name}</code>),
        ...it.tags.map(t => <code key={t}>mood: {t}</code>),
        ...it.ingredients.map(i => <code key={i}>uses: {catalog[i].name.toLowerCase()}</code>)
      ].concat(it.dishes.length + it.tags.length + it.ingredients.length ? [] : [<code key="none">nothing recognised</code>])}</div>}
      {results.map(ev => <div className="card" key={ev.recipe.id}>
        <button className="dish" onClick={() => openDish(ev.recipe.id)}><Art recipe={ev.recipe} /><div className="dish-body"><span className="card-name">{ev.recipe.name}</span></div></button>
        <ReadyLine recipe={ev.recipe} />
      </div>)}
      {it && !results.length && <div className="empty">None of your dishes match “{it.text}”.</div>}
      {it && <div className="card" style={{ background: 'var(--surface-2)', borderStyle: 'dashed' }}>
        {!recognised && aiUnderstood?.q !== query && it.text.split(/\s+/).length > 2 && <>
          <div className="sub">Didn’t catch that with the usual words. Let AI work out what you mean?</div>
          <button className="btn ghost" disabled={!!aiBusy} onClick={understand}>{aiBusy === 'parse' ? <><span className="spin" />Understanding…</> : '✨ Understand with AI'}</button>
        </>}
        <div className="sub">{results.length ? 'Want something different?' : 'Not in your recipes yet.'} AI can write “{it.text}” as a recipe for your kitchen, for you to review.</div>
        <button className={`btn ${results.length ? 'ghost' : 'accent'}`} disabled={!!aiBusy} onClick={write}>{aiBusy === 'draft' ? <><span className="spin" />Writing the recipe… about 20 s</> : `✨ Write “${it.text}”`}</button>
        {aiErr && <div className="sub missing">{aiErr}</div>}
      </div>}
    </div>
    {written && <RecipeEditor draft={written.recipe} newIngredients={written.newIngredients} why={written.why} onClose={() => setWritten(null)} />}
  </>
}
