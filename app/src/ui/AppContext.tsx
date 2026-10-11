import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import { isoDate, type Catalog, type Context, type Energy, type JournalEntry, type Kitchen, type Meal, type Recipe } from '../engine'
import { updateKitchen } from '../store/db'
import { useData } from '../store/hooks'

export type Tab = 'today' | 'ask' | 'pantry' | 'list' | 'my'

export function mealNow(d = new Date()): Meal {
  const h = d.getHours()
  return h >= 5 && h < 11 ? 'breakfast' : h >= 11 && h < 16 ? 'lunch' : h >= 16 && h < 19 ? 'snack' : 'dinner'
}

interface AppState {
  kitchen: Kitchen
  journal: JournalEntry[]
  catalog: Catalog
  recipes: Recipe[]
  hiddenRecipes: Recipe[]
  editedRecipes: Set<string>
  tab: Tab
  setTab: (t: Tab) => void
  meal: Meal
  setMeal: (m: Meal) => void
  energy: Energy
  setEnergy: (e: Energy) => void
  moods: string[]
  toggleMood: (m: string) => void
  query: string
  setQuery: (q: string) => void
  detail: string | null
  openDish: (id: string | null) => void
  /** Ranking context for "now". */
  ctx: Context
  toast: (msg: string) => void
  addToList: (ids: string[]) => void
  name: (id: string) => string
}

const Ctx = createContext<AppState | null>(null)
export const useApp = () => useContext(Ctx)!

export function AppProvider({ children }: { children: (ready: boolean, toastMsg: string | null) => ReactNode }) {
  const { kitchen, journal, catalog, recipes, hiddenRecipes, editedRecipes } = useData()
  const [tab, setTab] = useState<Tab>('today')
  const [meal, setMeal] = useState<Meal>(mealNow())
  const [energy, setEnergy] = useState<Energy>(2)
  const [moods, setMoods] = useState<string[]>([])
  const [query, setQuery] = useState('')
  const [detail, openDish] = useState<string | null>(null)
  const [toastMsg, setToast] = useState<string | null>(null)
  const timer = useRef<number>()

  const toast = useCallback((msg: string) => {
    setToast(msg)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setToast(null), 3000)
  }, [])
  const name = useCallback((id: string) => (catalog[id]?.name ?? id).toLowerCase(), [catalog])
  const addToList = useCallback((ids: string[]) => {
    const fresh = ids.filter(i => !kitchen?.list.includes(i))
    updateKitchen(k => ({ ...k, list: [...k.list, ...fresh.filter(i => !k.list.includes(i))] }))
    toast(fresh.length ? `Added ${fresh.map(name).join(', ')} to your list` : 'Already on your list')
  }, [kitchen, name, toast])

  const value = useMemo<AppState | null>(() => {
    if (!kitchen) return null
    const ctx: Context = { catalog, kitchen, journal, meal, energy, moods, today: isoDate(), now: Date.now() }
    return {
      kitchen, journal, catalog, recipes, hiddenRecipes, editedRecipes, tab, setTab, meal, setMeal, energy, setEnergy, moods,
      toggleMood: m => setMoods(ms => (ms.includes(m) ? ms.filter(x => x !== m) : [...ms, m])),
      query, setQuery, detail, openDish, ctx, toast, addToList, name
    }
  }, [kitchen, journal, catalog, recipes, hiddenRecipes, editedRecipes, tab, meal, energy, moods, query, detail, toast, addToList, name])

  return <Ctx.Provider value={value}>{children(!!value, toastMsg)}</Ctx.Provider>
}
