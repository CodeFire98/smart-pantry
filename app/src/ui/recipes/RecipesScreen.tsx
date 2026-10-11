import { useState } from 'react'
import { RECIPES, normalizeDraft, type Draft, type Recipe } from '../../engine'
import { ai } from '../../ai/api'
import { useAiContext } from '../../ai/useAi'
import { restoreRecipe } from '../../store/db'
import { useApp } from '../AppContext'
import { Art, Icon } from '../components'
import { RecipeEditor } from './RecipeEditor'

/** All recipes: search, edit, add, and restore hidden ones. */
export function RecipesScreen({ onClose }: { onClose: () => void }) {
  const { recipes, hiddenRecipes, editedRecipes, toast } = useApp()
  const [q, setQ] = useState('')
  const [editing, setEditing] = useState<{ id?: string; draft?: Draft } | null>(null)
  const { catalog } = useApp()
  const { context, explain } = useAiContext()
  const [ideas, setIdeas] = useState<Draft[]>([])
  const [aiState, setAiState] = useState<{ busy: boolean; err?: string }>({ busy: false })
  const suggest = async () => {
    setAiState({ busy: true })
    try {
      const { recipes: raw } = await ai.suggest(context())
      const taken = new Set([...recipes, ...hiddenRecipes].map(r => r.id))
      const drafts = raw.map(r => { const d = normalizeDraft(r, catalog, taken); if (d) taken.add(d.recipe.id); return d }).filter((d): d is Draft => !!d)
      setIdeas(drafts)
      setAiState({ busy: false, err: drafts.length ? undefined : 'The AI’s ideas didn’t come back in a usable form. Try again.' })
    } catch (e) { setAiState({ busy: false, err: explain(e) }) }
  }
  const match = (r: Recipe) => !q.trim() || r.name.toLowerCase().includes(q.trim().toLowerCase()) || r.tags.some(t => t.includes(q.trim().toLowerCase()))
  const isBuiltIn = (r: Recipe) => RECIPES.some(b => b.id === r.id)
  const mine = recipes.filter(r => !isBuiltIn(r) && match(r)).sort((a, b) => a.name.localeCompare(b.name))
  const built = recipes.filter(r => isBuiltIn(r) && match(r)).sort((a, b) => a.name.localeCompare(b.name))
  const hidden = hiddenRecipes.filter(match)

  const Row = ({ r }: { r: Recipe }) => <button className="dish recipe-row" onClick={() => setEditing({ id: r.id })}>
    <Art recipe={r} photo={false} />
    <div className="dish-body"><span className="card-name">{r.name}</span>
      <span className="sub">{r.tiers.map(t => t.name).join(' → ')} · {r.meals.join(', ')}{editedRecipes.has(r.id) ? ' · edited' : ''}</span></div>
    <span className="sub">›</span>
  </button>

  return <div className="overlay" role="dialog" aria-label="Recipes">
    <div className="ov-head">
      <button className="back" onClick={onClose} aria-label="Back">‹</button>
      <h2 style={{ flex: 1 }}>Recipes</h2>
      <button className="btn sm accent" onClick={() => setEditing({})}>{Icon.plus}New</button>
    </div>
    <div className="scroll" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <input className="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Search recipes" aria-label="Search recipes" />
      <div className="sub">Tap any dish to change its versions, ingredients, amounts or steps. Edits update suggestions straight away and sync to your other devices.</div>
      <div className="ai-card">
        <div className="row" style={{ justifyContent: 'space-between' }}><h2>✨ New dish ideas</h2><span className="sim">AI</span></div>
        <div className="sub">Based on what's in your pantry, what's expiring, your ratings and notes. You review and edit each one before it's added.</div>
        <button className="btn accent block" disabled={aiState.busy} onClick={suggest}>{aiState.busy ? <><span className="spin" />Thinking about your kitchen… about 40 s</> : ideas.length ? 'Suggest 3 more' : 'Suggest 3 dishes'}</button>
        {aiState.err && <div className="sub missing">{aiState.err}</div>}
        {ideas.map(d => <div className="newdish" key={d.recipe.id}>
          <div className="dish"><Art recipe={d.recipe} photo={false} /><div className="dish-body"><span className="card-name">{d.recipe.name}</span>
            <span className="sub">{d.recipe.tiers.map(t => t.name).join(' → ')} · {d.recipe.tiers[0].mins}–{d.recipe.tiers[d.recipe.tiers.length - 1].mins} min</span></div></div>
          {d.why && <div className="why">{d.why}</div>}
          <button className="btn sm accent" onClick={() => setEditing({ draft: d })}>Review &amp; add</button>
        </div>)}
      </div>
      <h2>Yours <span className="sub">({mine.length})</span></h2>
      {mine.length ? <div className="group">{mine.map(r => <Row key={r.id} r={r} />)}</div>
        : <div className="empty">No recipes of your own yet. Tap <b>New</b> to add one.</div>}
      <h2>Built-in <span className="sub">({built.length})</span></h2>
      <div className="group">{built.map(r => <Row key={r.id} r={r} />)}</div>
      {hidden.length > 0 && <>
        <h2>Hidden <span className="sub">({hidden.length})</span></h2>
        <div className="group">{hidden.map(r => <div className="prow" key={r.id}>
          <span className="pname">{r.name}<small>not suggested</small></span>
          <button className="btn sm ghost" onClick={async () => { await restoreRecipe(r.id, editedRecipes.has(r.id)); toast(`${r.name} is back`) }}>Restore</button>
        </div>)}</div>
      </>}
    </div>
    {editing && <RecipeEditor key={editing.id ?? editing.draft?.recipe.id ?? 'new'} recipeId={editing.id} draft={editing.draft?.recipe} newIngredients={editing.draft?.newIngredients} why={editing.draft?.why}
      onClose={() => { if (editing.draft) setIdeas(xs => xs.filter(x => recipes.every(r => r.id !== x.recipe.id) && x !== editing.draft)); setEditing(null) }} />}
  </div>
}
