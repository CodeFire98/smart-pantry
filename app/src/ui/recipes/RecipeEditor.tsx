import { useMemo, useState } from 'react'
import { RECIPES, newRecipeId, rowToSlot, slotToRow, type CustomIngredient, type IngRow, type Meal, type Recipe } from '../../engine'
import { deleteRecipe, hideRecipe, restoreRecipe, saveRecipe, updateKitchen } from '../../store/db'
import { useApp } from '../AppContext'
import { Icon } from '../components'

const MEALS: Meal[] = ['breakfast', 'lunch', 'snack', 'dinner']
const TIER_NAMES = ['Basic', 'Classic', 'Loaded', 'Special']

interface TierDraft { name: string; mins: string; effort: number; rows: IngRow[]; steps: string; needs?: string[] }
interface Draft { name: string; meals: Meal[]; tags: string; tiers: TierDraft[] }

const toDraft = (r?: Recipe): Draft => r
  ? { name: r.name, meals: [...r.meals], tags: r.tags.join(', '), tiers: r.tiers.map(t => ({ name: t.name, mins: String(t.mins), effort: t.effort, rows: t.add.map(slotToRow), steps: t.steps.join('\n'), needs: t.needs })) }
  : { name: '', meals: ['dinner'], tags: '', tiers: [{ name: 'Basic', mins: '15', effort: 1, rows: [], steps: '' }] }

/** Edit any recipe (built-in or yours) or create a new one. Versions are cumulative: each adds to the one before. */
export function RecipeEditor({ recipeId, onClose, draft, newIngredients = {}, why }: {
  recipeId?: string; onClose: () => void
  /** An AI draft to start from (saved as a new recipe). */
  draft?: Recipe; newIngredients?: Record<string, CustomIngredient>; why?: string
}) {
  const { recipes, hiddenRecipes, editedRecipes, catalog: baseCatalog, toast } = useApp()
  // AI drafts may use ingredients you don't have yet; they're offered here and added to your pantry only on save.
  const catalog = useMemo(() => ({ ...Object.fromEntries(Object.entries(newIngredients).map(([id, v]) => [id, { name: `${v.name} (new)`, cat: v.cat, unit: v.unit, kind: 'dur' as const, shelf: 0, sku: null }])), ...baseCatalog }), [baseCatalog, newIngredients])
  const original = recipeId ? [...recipes, ...hiddenRecipes].find(r => r.id === recipeId) : undefined
  const builtIn = !!recipeId && RECIPES.some(r => r.id === recipeId)
  const [d, setD] = useState<Draft>(() => toDraft(original ?? draft))
  const [err, setErr] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<'delete' | 'reset' | null>(null)
  const ingIds = useMemo(() => Object.keys(catalog).sort((a, b) => catalog[a].name.localeCompare(catalog[b].name)), [catalog])

  const setTier = (i: number, patch: Partial<TierDraft>) => setD(x => ({ ...x, tiers: x.tiers.map((t, j) => (j === i ? { ...t, ...patch } : t)) }))
  const setRow = (i: number, r: number, patch: Partial<IngRow>) => setTier(i, { rows: d.tiers[i].rows.map((row, k) => (k === r ? { ...row, ...patch } : row)) })
  const moveTier = (i: number, dir: -1 | 1) => setD(x => { const t = [...x.tiers]; [t[i], t[i + dir]] = [t[i + dir], t[i]]; return { ...x, tiers: t } })

  const build = (): Recipe => ({
    ...(original ?? (draft ? { art: draft.art } : {})),
    id: original?.id ?? newRecipeId(d.name, new Set([...recipes, ...hiddenRecipes].map(r => r.id))),
    name: d.name.trim(),
    meals: d.meals,
    tags: d.tags.split(',').map(t => t.trim().toLowerCase()).filter(Boolean),
    tiers: d.tiers.map(t => ({
      name: t.name.trim(), mins: Number(t.mins), effort: t.effort,
      add: t.rows.filter(r => r.id).map(rowToSlot),
      steps: t.steps.split('\n').map(s => s.trim()).filter(Boolean),
      ...(t.needs?.length ? { needs: t.needs } : {})
    }))
  } as Recipe)

  const save = async () => {
    setErr(null)
    if (!d.name.trim()) return setErr('Give the dish a name.')
    if (!d.meals.length) return setErr('Pick at least one meal.')
    const bad = d.tiers.findIndex(t => !t.name.trim() || !(Number(t.mins) > 0) || !t.rows.some(r => r.id))
    if (bad >= 0) return setErr(`Version ${bad + 1} needs a name, minutes and at least one ingredient.`)
    try {
      const recipe = build()
      const used = new Set(recipe.tiers.flatMap(t => t.add.flatMap(s => s.replace('?', '').split('|').map(a => a.split(':')[0]))))
      const toAdd = Object.entries(newIngredients).filter(([id]) => used.has(id) && !baseCatalog[id])
      if (toAdd.length) await updateKitchen(k => ({
        ...k,
        customIngredients: { ...k.customIngredients, ...Object.fromEntries(toAdd) },
        items: { ...k.items, ...Object.fromEntries(toAdd.map(([id, v]) => [id, v.unit ? { q: 0 } : { l: 0 }])) }
      }))
      await saveRecipe(recipe)
      toast(`${d.name.trim()} saved`)
      onClose()
    } catch (e) { setErr(e instanceof Error ? e.message : 'Couldn’t save this recipe.') }
  }

  const unitOf = (id: string) => catalog[id]?.unit
  return <div className="overlay" role="dialog" aria-label={original ? `Edit ${original.name}` : 'New recipe'} style={{ zIndex: 7 }}>
    <div className="ov-head">
      <button className="back" onClick={onClose} aria-label="Back">‹</button>
      <h2 style={{ flex: 1 }}>{original ? 'Edit recipe' : draft ? 'Review AI draft' : 'New recipe'}</h2>
      <button className="btn sm accent" onClick={save}>{Icon.check}Save</button>
    </div>
    <div className="scroll editor">
      {err && <div className="warn" style={{ color: 'var(--miss)', background: 'var(--miss-soft)' }}>{err}</div>}
      {draft && <div className="card ai-note"><b>✨ Drafted by AI</b>{why && <span className="sub">{why}</span>}
        <span className="sub">Check the amounts and steps, change anything, then Save.{Object.keys(newIngredients).length ? ` Items marked “(new)” will be added to your pantry as out of stock.` : ''}</span></div>}
      <label className="field">Dish name<input id="recipe-name" value={d.name} onChange={e => setD({ ...d, name: e.target.value })} placeholder="e.g. Rajma Chawal" /></label>
      <div><div className="sub" style={{ marginBottom: 6 }}>Good for</div>
        <div className="row">{MEALS.map(m => <button type="button" key={m} className="chip" aria-pressed={d.meals.includes(m)}
          onClick={() => setD({ ...d, meals: d.meals.includes(m) ? d.meals.filter(x => x !== m) : [...d.meals, m] })}>{m}</button>)}</div></div>
      <label className="field">Tags <span className="sub">comma-separated, e.g. spicy, comfort, protein</span>
        <input id="recipe-tags" value={d.tags} onChange={e => setD({ ...d, tags: e.target.value })} /></label>

      {d.tiers.map((t, i) => <div className="tier" key={i}>
        <div className="tier-head">
          <input className="tier-name" value={t.name} onChange={e => setTier(i, { name: e.target.value })} aria-label={`Version ${i + 1} name`} />
          <span className="row" style={{ gap: 4 }}>
            {i > 0 && <button type="button" className="x" onClick={() => moveTier(i, -1)} aria-label="Move up">↑</button>}
            {i < d.tiers.length - 1 && <button type="button" className="x" onClick={() => moveTier(i, 1)} aria-label="Move down">↓</button>}
            {d.tiers.length > 1 && <button type="button" className="x" onClick={() => setD({ ...d, tiers: d.tiers.filter((_, j) => j !== i) })} aria-label={`Remove version ${t.name}`}>×</button>}
          </span>
        </div>
        {i > 0 && <div className="plus">Adds to {d.tiers[i - 1].name || `version ${i}`}</div>}
        <div className="row">
          <label className="field inline">Minutes<input inputMode="numeric" value={t.mins} onChange={e => setTier(i, { mins: e.target.value })} className="num" /></label>
          <span className="sub">Effort</span>
          <div className="seg">{[1, 2, 3].map(n => <button type="button" key={n} aria-pressed={t.effort === n} onClick={() => setTier(i, { effort: n })}>{['Easy', 'Some', 'Lots'][n - 1]}</button>)}</div>
        </div>
        <div className="sub" style={{ fontWeight: 600 }}>Ingredients this version adds</div>
        {t.rows.map((r, k) => <div className="ing-row" key={k}>
          <select value={r.id} onChange={e => setRow(i, k, { id: e.target.value, q: unitOf(e.target.value) ? r.q : null })} aria-label="Ingredient">
            <option value="">Choose…</option>
            {ingIds.map(id => <option key={id} value={id}>{catalog[id].name}</option>)}
          </select>
          {unitOf(r.id) && <label className="row sub" style={{ gap: 4 }}><input className="num" inputMode="decimal" value={r.q ?? ''} placeholder="amt"
            onChange={e => setRow(i, k, { q: e.target.value === '' ? null : Number(e.target.value) })} aria-label="Amount" />{unitOf(r.id) === 'pc' ? 'pc' : unitOf(r.id)}</label>}
          <label className="row sub" style={{ gap: 4 }}><input type="checkbox" checked={r.opt} onChange={e => setRow(i, k, { opt: e.target.checked })} />optional</label>
          <select value={r.subId ?? ''} onChange={e => setRow(i, k, { subId: e.target.value || undefined, subQ: e.target.value && unitOf(e.target.value) ? r.q : null })} aria-label="Or substitute" className="sub-select">
            <option value="">no substitute</option>
            {ingIds.filter(id => id !== r.id).map(id => <option key={id} value={id}>or {catalog[id].name}</option>)}
          </select>
          <button type="button" className="x" onClick={() => setTier(i, { rows: t.rows.filter((_, j) => j !== k) })} aria-label="Remove ingredient">×</button>
        </div>)}
        <button type="button" className="btn sm ghost" style={{ alignSelf: 'flex-start' }} onClick={() => setTier(i, { rows: [...t.rows, { id: '', q: null, opt: false }] })}>{Icon.plus}Add ingredient</button>
        <label className="field">Steps <span className="sub">one per line</span>
          <textarea value={t.steps} onChange={e => setTier(i, { steps: e.target.value })} rows={3} /></label>
      </div>)}
      {d.tiers.length < 4 && <button type="button" className="btn ghost" onClick={() => setD({ ...d, tiers: [...d.tiers, { name: TIER_NAMES[d.tiers.length] ?? 'Extra', mins: d.tiers[d.tiers.length - 1]?.mins ?? '20', effort: d.tiers[d.tiers.length - 1]?.effort ?? 1, rows: [], steps: '' }] })}>{Icon.plus}Add a richer version</button>}

      {original && <div className="card" style={{ marginTop: 8 }}>
        {builtIn ? <>
          {confirm === 'reset'
            ? <div className="row"><span className="sub">Undo all your edits to this dish?</span><button className="btn sm ghost" onClick={() => setConfirm(null)}>Keep</button>
                <button className="btn sm" onClick={async () => { await restoreRecipe(original.id); toast('Back to the original recipe'); onClose() }}>Reset</button></div>
            : editedRecipes.has(original.id) && <button className="linkbtn" onClick={() => setConfirm('reset')}>Reset to the original recipe</button>}
          <button className="linkbtn" style={{ color: 'var(--miss)' }} onClick={async () => { await hideRecipe(original.id); toast(`${original.name} hidden. Restore it from My → Recipes.`); onClose() }}>Hide this dish</button>
        </> : confirm === 'delete'
          ? <div className="row"><span className="sub missing">Delete {original.name}?</span><button className="btn sm ghost" onClick={() => setConfirm(null)}>Keep</button>
              <button className="btn sm" style={{ background: 'var(--miss)' }} onClick={async () => { await deleteRecipe(original.id); toast(`${original.name} deleted`); onClose() }}>Delete</button></div>
          : <button className="linkbtn" style={{ color: 'var(--miss)' }} onClick={() => setConfirm('delete')}>Delete this recipe</button>}
      </div>}
    </div>
  </div>
}
