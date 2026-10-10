import { useRef } from 'react'
import { taste, type JournalEntry } from '../../engine'
import { exportBackup, importBackup, importRecipes } from '../../store/db'
import { usePhotoUrl } from '../../store/hooks'
import { useApp } from '../AppContext'
import { Art, Section } from '../components'
import { SwiggyCard } from '../swiggy/SwiggyCard'

function Entry({ j }: { j: JournalEntry }) {
  const { recipes, openDish } = useApp()
  const url = usePhotoUrl(j.photoId)
  const r = recipes.find(x => x.id === j.recipeId)
  return <button className="entry" style={{ padding: 0, textAlign: 'left' }} onClick={() => r && openDish(r.id)}>
    <div className="ph">{url ? <img src={url} alt={j.recipeName} /> : r ? <Art recipe={r} photo={false} /> : null}</div>
    <div className="entry-body">
      <b>{j.recipeName}</b>
      <span className="sub" style={{ fontSize: 11.5 }}>{j.tier} · {new Date(j.at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</span>
      {j.rating ? <span className="rating">{'★'.repeat(j.rating)}{'☆'.repeat(5 - j.rating)}</span> : null}
      {j.note && <span className="note">{j.note}</span>}
    </div>
  </button>
}

export function My() {
  const { journal, recipes, toast } = useApp()
  const fileRecipes = useRef<HTMLInputElement>(null), fileBackup = useRef<HTMLInputElement>(null)
  const t = taste(journal, recipes)
  const rated = journal.filter(j => j.rating)
  const avg = rated.length ? rated.reduce((a, j) => a + j.rating!, 0) / rated.length : null
  const counts: Record<string, number> = {}
  journal.forEach(j => { counts[j.recipeName] = (counts[j.recipeName] ?? 0) + 1 })
  const fav = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]
  const custom = recipes.filter(r => r.custom)

  const readJson = async (f: File) => JSON.parse(await f.text())
  const onRecipes = async (f?: File) => {
    if (!f) return
    try {
      const res = await importRecipes(await readJson(f))
      toast(res.error ? `Couldn’t import: ${res.error}` : `Added ${res.added.join(', ')}`)
    } catch { toast('That file isn’t valid JSON.') }
  }
  const onBackup = async (f?: File) => {
    if (!f) return
    try { await importBackup(await readJson(f)); toast('Backup restored') }
    catch (e) { toast(e instanceof Error ? e.message : 'That backup couldn’t be read.') }
  }
  const download = async () => {
    const blob = new Blob([JSON.stringify(await exportBackup(), null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `smart-pantry-backup-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }

  return <>
    <div className="eyebrow">Your cooking journal</div>
    <h1>My kitchen</h1>
    <div className="stats">
      <div className="stat"><b>{journal.length}</b><span>meals logged</span></div>
      <div className="stat"><b>{avg ? `${avg.toFixed(1)}★` : '–'}</b><span>avg rating</span></div>
      <div className="stat"><b style={{ fontSize: 15, lineHeight: 1.9 }}>{fav ? fav[0].split(' ').slice(-2).join(' ') : '–'}</b><span>most cooked</span></div>
    </div>
    {(t.liked.length > 0 || t.meh.length > 0) && <Section title="Your taste so far" sub="from your ratings">
      <div className="taste">{t.liked.map(x => <span key={x}>loves {x}</span>)}{t.meh.map(x => <span key={x} className="meh">meh on {x}</span>)}</div>
    </Section>}
    <Section title="Instamart"><SwiggyCard /></Section>
    <Section title="Cooked" sub="saved on this phone">
      {journal.length
        ? <div className="journal">{journal.slice(0, 60).map(j => <Entry key={j.id} j={j} />)}</div>
        : <div className="empty">Nothing logged yet. Cook something, then tap <b>I cooked this</b> on the dish. Add a photo, a rating and a note: your photos become the dish covers, and ratings tune what gets suggested.</div>}
    </Section>
    <Section title="Your recipes" sub={`${custom.length} added`}>
      <div className="card">
        <div className="sub">Import recipes as JSON in the same 3-version format, for example drafts from the prototype's “Suggest new dishes” button. Built-in AI drafting arrives in Phase 3.</div>
        {custom.length > 0 && <div className="sub"><b>Added:</b> {custom.map(r => r.name).join(', ')}</div>}
        <input ref={fileRecipes} className="visually-hidden" type="file" accept="application/json,.json" onChange={e => { onRecipes(e.target.files?.[0]); e.target.value = '' }} />
        <button className="btn sm ghost" onClick={() => fileRecipes.current?.click()}>Import recipe JSON</button>
      </div>
    </Section>
    <Section title="Backup" sub="photos stay on this phone">
      <div className="row">
        <button className="btn sm ghost" onClick={download}>Download backup</button>
        <input ref={fileBackup} className="visually-hidden" type="file" accept="application/json,.json" onChange={e => { onBackup(e.target.files?.[0]); e.target.value = '' }} />
        <button className="btn sm ghost" onClick={() => fileBackup.current?.click()}>Restore from file</button>
      </div>
    </Section>
  </>
}
