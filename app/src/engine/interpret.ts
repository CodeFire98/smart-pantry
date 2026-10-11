import type { Catalog, Recipe } from './types'

const TAG_WORDS: Record<string, string> = {
  spicy: 'spicy', light: 'light', comfort: 'comfort', comforting: 'comfort', healthy: 'healthy', protein: 'protein',
  quick: 'quick', fast: 'quick', lazy: 'quick', tired: 'quick', easy: 'quick', indulgent: 'indulgent', heavy: 'indulgent',
  cheesy: 'indulgent', chinese: 'indo-chinese', sweet: 'sweet', crispy: 'crispy', tangy: 'tangy'
}

export interface Interpretation {
  text: string
  dishes: Recipe[]
  tags: string[]
  ingredients: string[]
  results: Recipe[]
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Free text → dish names, mood tags and ingredients, using fixed word lists only. */
export function interpret(query: string, recipes: Recipe[], catalog: Catalog): Interpretation | null {
  const text = query.toLowerCase().trim()
  if (!text) return null
  const words = text.split(/[^a-z-]+/).filter(Boolean)
  // A dish matches when its whole name is in the query, or (2+ word queries) every word of the query is in its name:
  // "avocado toast" finds "Spiced Avocado Toast".
  const named = words.filter(w => w.length > 2 && !TAG_WORDS[w])
  const inName = (n: string) => { const nw = n.toLowerCase().split(/[^a-z-]+/); return named.length >= 2 && named.length === words.length && named.every(w => nw.includes(w) || nw.includes(`${w}s`)) }
  const dishes = recipes.filter(r => [r.name.toLowerCase(), ...(r.aliases ?? [])].some(a => new RegExp(`\\b${escapeRe(a.toLowerCase())}\\b`).test(text)) || inName(r.name))
  const tags = [...new Set(words.map(w => TAG_WORDS[w]).filter(Boolean))]
  const ingredients = Object.keys(catalog).filter(id => {
    const n = catalog[id].name.toLowerCase()
    return words.some(w => w.length > 2 && (n === w || n === `${w}s` || n.split(' ').includes(w) || id === w))
  })
  const uses = (r: Recipe, id: string) => r.tiers.some(t => t.add.some(s => s.replace('?', '').split('|').some(a => a.split(':')[0] === id)))
  let results = dishes.length
    ? dishes
    : recipes.filter(r => (!ingredients.length || ingredients.some(i => uses(r, i))) && (!tags.length || tags.every(t => r.tags.includes(t))))
  if (!dishes.length && !tags.length && !ingredients.length) results = []
  return { text, dishes, tags, ingredients, results }
}
