import { useState, type ReactNode } from 'react'
import { refreshProfile, saveProfileText, useActivityCount } from '../ai/profile'
import { useAiContext } from '../ai/useAi'
import { PROFILE_MIN_NEW } from '../engine'
import { allActivity } from '../store/activity'
import { useApp } from './AppContext'

/** Tiny markdown: ## headings, - bullets, **bold**. Everything else is a paragraph. */
function Markdown({ text }: { text: string }) {
  const inline = (s: string) => s.split(/(\*\*[^*]+\*\*)/g).map((p, i) => (p.startsWith('**') && p.endsWith('**') ? <b key={i}>{p.slice(2, -2)}</b> : p))
  const out: ReactNode[] = []
  let bullets: string[] = []
  const flush = () => { if (bullets.length) out.push(<ul key={out.length}>{bullets.map((b, i) => <li key={i}>{inline(b)}</li>)}</ul>); bullets = [] }
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (/^[-*•] /.test(line)) { bullets.push(line.slice(2)); continue }
    flush()
    if (!line) continue
    const h = line.match(/^#{1,4}\s+(.*)$/)
    out.push(h ? <h3 key={out.length}>{inline(h[1])}</h3> : <p key={out.length}>{inline(line)}</p>)
  }
  flush()
  return <div className="md">{out}</div>
}

const save = (name: string, type: string, body: string) => {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([body], { type }))
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}
const ago = (t: number) => { const d = Math.floor((Date.now() - t) / 86_400_000); return d <= 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago` }

/** My → About my cooking: the AI-written taste profile, editable, plus the activity log download. */
export function ProfileCard() {
  const { kitchen, toast } = useApp()
  const { explain } = useAiContext()
  const count = useActivityCount()
  const p = kitchen.profile
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const date = new Date().toISOString().slice(0, 10)

  const refresh = async () => {
    setBusy(true); setErr(null)
    try { await refreshProfile(kitchen); toast('Profile updated from your activity') } catch (e) { setErr(explain(e)) } finally { setBusy(false) }
  }
  const downloadActivity = async () => save(`smart-pantry-activity-${date}.json`, 'application/json',
    JSON.stringify({ app: 'smart-pantry', exportedAt: new Date().toISOString(), profile: p ?? null, activity: await allActivity() }, null, 2))

  return <div className="card profile">
    {editing != null ? <>
      <textarea className="profile-edit" value={editing} onChange={e => setEditing(e.target.value)} rows={14} aria-label="About my cooking" />
      <div className="sub">Write anything you want the AI to know. Use “## ” for headings and “- ” for points. AI refreshes keep what you write here.</div>
      <div className="row">
        <button className="btn sm accent" onClick={async () => { await saveProfileText(editing); setEditing(null); toast('Saved') }}>Save</button>
        <button className="btn sm ghost" onClick={() => setEditing(null)}>Cancel</button>
      </div>
    </> : p?.text ? <>
      <Markdown text={p.text} />
      <div className="sub">{p.by === 'you' ? 'Edited by you' : 'Written by AI from your activity'} {ago(p.at)} · the AI reads this before suggesting or writing recipes.</div>
    </> : <div className="sub">
      As you search, open dishes, cook, add to your list and order, the app keeps a log. After {PROFILE_MIN_NEW} things, AI writes a short profile of what you like here, refreshes it each week, and reads it before suggesting or writing recipes.
    </div>}
    {editing == null && <div className="row">
      <button className="btn sm accent" disabled={busy || count < 3} onClick={refresh}>{busy ? <><span className="spin" />Writing…</> : p ? '✨ Refresh now' : '✨ Write it now'}</button>
      <button className="btn sm ghost" onClick={() => setEditing(p?.text ?? '## What I love\n- \n\n## How I cook\n- \n\n## What I buy\n- \n\n## Try next\n- ')}>Edit</button>
      {p?.text && <button className="btn sm ghost" onClick={() => save(`about-my-cooking-${date}.md`, 'text/markdown', p.text + '\n')}>Download .md</button>}
    </div>}
    {err && <div className="sub missing">{err}</div>}
    <div className="sub activity-line">{count} thing{count === 1 ? '' : 's'} logged · <button className="linkbtn" onClick={downloadActivity}>Download activity (JSON)</button></div>
  </div>
}
