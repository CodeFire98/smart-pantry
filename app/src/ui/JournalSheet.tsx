import { useState } from 'react'
import type { JournalEntry } from '../engine'
import { deleteJournal, setJournalPhoto, updateJournal } from '../store/db'
import { shrinkPhoto, usePhotoUrl } from '../store/hooks'
import { useApp } from './AppContext'
import { Art, Icon } from './components'

/** Edit a logged cook: version, rating, note, photo (add later / replace / remove), or delete it. */
export function JournalSheet({ entry, onClose }: { entry: JournalEntry; onClose: () => void }) {
  const { recipes, openDish, setTab, toast } = useApp()
  const r = recipes.find(x => x.id === entry.recipeId)
  const url = usePhotoUrl(entry.photoId)
  const [tierIndex, setTierIndex] = useState(entry.tierIndex)
  const [rating, setRating] = useState(entry.rating ?? 0)
  const [note, setNote] = useState(entry.note)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [busy, setBusy] = useState(false)
  const id = entry.id!
  const dirty = tierIndex !== entry.tierIndex || rating !== (entry.rating ?? 0) || note.trim() !== entry.note

  const pick = async (f?: File) => {
    if (!f) return
    setBusy(true)
    try { await setJournalPhoto(id, await shrinkPhoto(f)); toast('Photo saved') }
    catch { toast('That photo couldn’t be read. Try a JPEG or PNG.') }
    finally { setBusy(false) }
  }
  const save = async () => {
    await updateJournal(id, { tierIndex, tier: r?.tiers[tierIndex]?.name ?? entry.tier, rating: rating || null, note: note.trim() })
    toast('Saved'); onClose()
  }

  return <div className="sheet-bg" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
    <div className="sheet" role="dialog" aria-label={`Edit ${entry.recipeName}`}>
      <div><div className="eyebrow">{new Date(entry.at).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}</div>
        <h2 style={{ fontSize: 20 }}>{entry.recipeName}</h2></div>

      <label className="photo-pick" htmlFor="journal-photo" style={{ minHeight: 180 }}>
        {url ? <img src={url} alt={`Your photo of ${entry.recipeName}`} /> : r ? <div style={{ width: 120, height: 120 }}><Art recipe={r} photo={false} /></div> : null}
        <input type="file" id="journal-photo" accept="image/*" onChange={e => { pick(e.target.files?.[0]); e.target.value = '' }} />
        <span className="photo-cta">{busy ? <span className="spin" /> : Icon.cam}{url ? 'Replace photo' : 'Add photo'}</span>
      </label>
      {url && <button className="linkbtn" style={{ alignSelf: 'flex-start' }} onClick={async () => { await setJournalPhoto(id, null); toast('Photo removed') }}>Remove photo</button>}

      {r && <div>
        <div className="sub" style={{ marginBottom: 6 }}>Version you made</div>
        <div className="row">{r.tiers.map((t, i) => <button key={t.name} className="chip" aria-pressed={tierIndex === i} onClick={() => setTierIndex(i)}>{t.name}</button>)}</div>
      </div>}
      <div><div className="sub" style={{ marginBottom: 4 }}>How was it?</div>
        <div className="stars" role="radiogroup" aria-label="Rating">{[1, 2, 3, 4, 5].map(n =>
          <button type="button" key={n} role="radio" aria-checked={rating === n} aria-label={`${n} star${n > 1 ? 's' : ''}`} className={n <= rating ? 'on' : ''} onClick={() => setRating(n === rating ? 0 : n)}>★</button>)}</div></div>
      <textarea id="journal-note" value={note} onChange={e => setNote(e.target.value)} placeholder="Notes for next time" />
      <div className="sub">Editing doesn’t change your pantry.</div>

      <div className="row" style={{ justifyContent: 'space-between' }}>
        {confirmDelete
          ? <span className="row"><span className="sub missing">Delete this entry?</span>
              <button className="btn sm ghost" onClick={() => setConfirmDelete(false)}>Keep</button>
              <button className="btn sm" style={{ background: 'var(--miss)' }} onClick={async () => { await deleteJournal(id); toast('Entry deleted'); onClose() }}>Delete</button></span>
          : <button className="linkbtn" style={{ color: 'var(--miss)' }} onClick={() => setConfirmDelete(true)}>Delete entry</button>}
        {r && !confirmDelete && <button className="linkbtn" onClick={() => { onClose(); setTab('today'); openDish(r.id) }}>Open recipe</button>}
      </div>
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button className="btn ghost" onClick={onClose}>{dirty ? 'Cancel' : 'Close'}</button>
        {dirty && <button className="btn accent" onClick={save}>{Icon.check}Save</button>}
      </div>
    </div>
  </div>
}
