import { useState } from 'react'
import { equipMissing, evaluate, fits, have, missing, parseSlot, tierSlots, type Recipe } from '../../engine'
import { logCook } from '../../store/db'
import { shrinkPhoto } from '../../store/hooks'
import { useApp } from '../AppContext'
import { Art, Dots, Icon } from '../components'

export function DishDetail({ recipe: r }: { recipe: Recipe }) {
  const { kitchen, catalog, ctx, energy, journal, openDish, addToList, name } = useApp()
  const [logTier, setLogTier] = useState<number | null>(null)
  const [showWhy, setShowWhy] = useState(false)
  const ev = evaluate(r, ctx)
  const cooked = journal.filter(j => j.recipeId === r.id)
  const fmt = (id: string, q: number) => (catalog[id]?.unit === 'pc' ? `${q}` : `${q} ${catalog[id]?.unit}`)

  return <div className="overlay" role="dialog" aria-label={r.name}>
    <div className="ov-head">
      <button className="back" onClick={() => openDish(null)} aria-label="Back">‹</button>
      <span className="sub" style={{ flex: 1 }}>{r.meals.join(' · ')}</span>
      <button className="linkbtn" onClick={() => setShowWhy(s => !s)}>score {ev.score}</button>
    </div>
    <div className="scroll" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="detail-hero"><Art recipe={r} />
        <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <h1 style={{ fontSize: 24 }}>{r.name}</h1>
          <div className="sub">{r.tags.join(' · ')}</div>
          <div className="sub">{cooked.length ? `Cooked ${cooked.length}×${cooked[0].rating ? ` · last rated ${'★'.repeat(cooked[0].rating)}` : ''}` : 'Your first photo of this dish becomes its cover'}</div>
        </div>
      </div>
      {showWhy && <div className="trace-card">
        <div className="sub">Why it scored {ev.score} for {ctx.meal}, {['', 'low', 'medium', 'high'][energy]} energy</div>
        {ev.terms.map(t => <div className="term" key={t.label}><span>{t.label}</span><span className={`pts ${t.points > 0 ? 'pos' : t.points < 0 ? 'neg' : 'nil'}`}>{t.points > 0 ? '+' : ''}{t.points}</span></div>)}
      </div>}
      {r.tiers.map((t, i) => {
        const miss = missing(r, i, kitchen, catalog), eq = equipMissing(r, i, kitchen), ready = !miss.length && !eq.length, fit = fits(t, energy)
        const price = miss.reduce((a, x) => a + (catalog[x]?.sku?.price ?? 0), 0)
        return <div key={t.name} className={`tier ${ready && fit ? 'ready' : ''}`}>
          <div className="tier-head">
            <div><h2>{t.name}</h2><div className="meta">{t.mins} min <Dots effort={t.effort} /></div></div>
            {eq.length ? <span className="status effort">Needs a {eq[0]}</span>
              : ready ? (fit ? <span className="status ready">Ready</span> : <span className="status effort">Ready · above your energy</span>)
              : <span className="status need">{miss.length} missing</span>}
          </div>
          {i > 0 && <div className="plus">Adds to {r.tiers[i - 1].name}</div>}
          <div className="ings">{t.add.map(parseSlot).map(sl => {
            const h = have(sl, kitchen, catalog), label = name(sl.main), qn = sl.need ? ` · ${fmt(sl.main, sl.need)}` : ''
            const key = sl.main + i
            if (h.ok && h.sub) return <span key={key} className="ing have">{name(h.id!)} for {label}</span>
            if (h.ok && h.unsure) return <span key={key} className="ing unsure">{label}?</span>
            if (h.ok && h.low && h.need) return <span key={key} className="ing low">{label} · {fmt(h.id!, h.q!)} of {fmt(h.id!, h.need)}</span>
            if (h.ok && h.low) return <span key={key} className="ing low">{label} · low</span>
            if (h.ok) return <span key={key} className="ing have">✓ {label}{qn}</span>
            if (sl.opt) return <span key={key} className="ing opt">{label} (optional)</span>
            return <span key={key} className="ing miss">✗ {label}{qn}</span>
          })}</div>
          <ol className="steps">{t.steps.map(s => <li key={s}>{s}</li>)}</ol>
          <div>{ready
            ? <button className="btn sm" onClick={() => setLogTier(i)}>{Icon.check}I cooked this</button>
            : miss.length > 0 && <button className="btn sm accent" onClick={() => addToList(miss)}>{Icon.cart}Add {miss.length} to list · ≈ ₹{price}</button>}</div>
        </div>
      })}
    </div>
    {logTier != null && <LogSheet recipe={r} tierIndex={logTier} onClose={() => setLogTier(null)} />}
  </div>
}

function LogSheet({ recipe, tierIndex, onClose }: { recipe: Recipe; tierIndex: number; onClose: () => void }) {
  const { kitchen, catalog, toast, openDish, name } = useApp()
  const [rating, setRating] = useState(0)
  const [note, setNote] = useState('')
  const [photo, setPhoto] = useState<Blob | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const t = recipe.tiers[tierIndex]
  const willUse = tierSlots(recipe, tierIndex).map(sl => ({ sl, h: have(sl, kitchen, catalog) }))
    .filter(x => x.h.ok && catalog[x.h.id!].kind !== 'stp')
    .map(({ sl, h }) => {
      const id = h.id!, unit = catalog[id].unit
      if (!unit) return name(id)
      const q = Math.min(h.q ?? 1, sl.alts.find(a => a.id === id)?.q ?? 1)
      return unit === 'pc' ? `${name(id)} ×${q}` : `${q} ${unit} ${name(id)}`
    })

  const pick = async (f?: File) => {
    if (!f) return
    try {
      const b = await shrinkPhoto(f)
      setPhoto(b)
      if (preview) URL.revokeObjectURL(preview)
      setPreview(URL.createObjectURL(b))
    } catch { toast('That photo couldn’t be read. Try a JPEG or PNG.') }
  }
  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      const used = await logCook({ recipe, tierIndex, rating: rating || null, note: note.trim(), photo, catalog })
      toast(`Logged ${recipe.name}. Used ${used.length ? used.map(u => { const unit = catalog[u.id].unit; return u.amount == null || !unit ? name(u.id) : unit === 'pc' ? `${name(u.id)} ×${u.amount}` : `${u.amount} ${unit} ${name(u.id)}` }).join(', ') : 'staples only'}.`)
      openDish(null)
    } catch {
      toast('Couldn’t save that. Your phone may be out of storage.')
      setBusy(false)
    }
  }

  return <div className="sheet-bg" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
    <form className="sheet" onSubmit={save} role="dialog" aria-label="Log this meal">
      <div><div className="eyebrow">I cooked</div><h2 style={{ fontSize: 20 }}>{recipe.name} · {t.name}</h2></div>
      <label className="photo-pick" htmlFor="photo">
        {preview ? <img src={preview} alt="Your photo" /> : <>{Icon.cam}Add a photo</>}
        <input type="file" id="photo" accept="image/*" onChange={e => pick(e.target.files?.[0])} />
      </label>
      <div><div className="sub" style={{ marginBottom: 4 }}>How was it?</div>
        <div className="stars" role="radiogroup" aria-label="Rating">{[1, 2, 3, 4, 5].map(n =>
          <button type="button" key={n} role="radio" aria-checked={rating === n} aria-label={`${n} star${n > 1 ? 's' : ''}`} className={n <= rating ? 'on' : ''} onClick={() => setRating(n)}>★</button>)}</div></div>
      <textarea id="note" value={note} onChange={e => setNote(e.target.value)} placeholder="Notes for next time, e.g. more chilli, less salt, try with cream" />
      <div className="sub">Pantry update: {willUse.length ? willUse.join(', ') : 'only staples used'}.</div>
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
        <button type="submit" className="btn accent" disabled={busy}>{busy ? <span className="spin" /> : Icon.check}{busy ? 'Saving…' : 'Save to journal'}</button>
      </div>
    </form>
  </div>
}
