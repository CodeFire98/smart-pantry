import { useEffect, useRef } from 'react'
import { AppProvider, useApp, type Tab } from './AppContext'
import { Ask } from './screens/Ask'
import { DishDetail } from './screens/DishDetail'
import { List } from './screens/List'
import { My } from './screens/My'
import { Pantry } from './screens/Pantry'
import { Today } from './screens/Today'

const TABS: { id: Tab; label: string; icon: JSX.Element }[] = [
  { id: 'today', label: 'Today', icon: <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg> },
  { id: 'ask', label: 'I want', icon: <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></svg> },
  { id: 'pantry', label: 'Pantry', icon: <svg viewBox="0 0 24 24"><rect x="5" y="2.5" width="14" height="19" rx="2" /><path d="M5 10h14M8 6v2M8 13v3" /></svg> },
  { id: 'list', label: 'List', icon: <svg viewBox="0 0 24 24"><path d="M3 4h2l2.4 11.2a1 1 0 0 0 1 .8h8.8a1 1 0 0 0 1-.8L20 8H6.2" /><circle cx="9" cy="20" r="1.3" /><circle cx="17" cy="20" r="1.3" /></svg> },
  { id: 'my', label: 'My', icon: <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><path d="M12 3v2M12 19v2" /></svg> }
]

function Shell({ toast }: { toast: string | null }) {
  const { tab, setTab, detail, recipes, kitchen, openDish } = useApp()
  const scroller = useRef<HTMLDivElement>(null)
  useEffect(() => { scroller.current?.scrollTo(0, 0) }, [tab])
  const dish = detail ? recipes.find(r => r.id === detail) : null
  const Screen = { today: Today, ask: Ask, pantry: Pantry, list: List, my: My }[tab]
  return <div className="phone">
    <div className="scroll" ref={scroller}><Screen /></div>
    <nav className="tabbar" aria-label="Sections">
      {TABS.map(t => <button key={t.id} className="tab" aria-current={tab === t.id} onClick={() => { setTab(t.id); openDish(null) }}>
        {t.icon}{t.label}{t.id === 'list' && kitchen.list.length > 0 && <span className="badge">{kitchen.list.length}</span>}
      </button>)}
    </nav>
    {dish && <DishDetail key={dish.id} recipe={dish} />}
    <div className="toast" hidden={!toast} role="status">{toast}</div>
  </div>
}

export function App() {
  return <AppProvider>{(ready, toast) => ready ? <Shell toast={toast} /> : <div className="phone"><div className="scroll"><div className="empty" style={{ marginTop: 40 }}>Opening your kitchen…</div></div></div>}</AppProvider>
}
