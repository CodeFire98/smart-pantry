import type { JournalEntry, Recipe } from './types'

export interface Taste {
  recipe: Record<string, { avg: number; n: number }>
  /** Tags rated ≥ 4 on average across at least 2 cooks, best first. */
  liked: string[]
  /** Tags rated ≤ 2.5 on average across at least 2 cooks. */
  meh: string[]
}

export function taste(journal: JournalEntry[], recipes: Recipe[]): Taste {
  const byRecipe: Record<string, number[]> = {}, byTag: Record<string, number[]> = {}
  const tagsOf = new Map(recipes.map(r => [r.id, r.tags]))
  for (const j of journal) {
    if (!j.rating) continue
    ;(byRecipe[j.recipeId] ??= []).push(j.rating)
    for (const t of tagsOf.get(j.recipeId) ?? []) (byTag[t] ??= []).push(j.rating)
  }
  const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length
  const tags = Object.entries(byTag).map(([t, a]) => ({ t, avg: avg(a), n: a.length }))
  return {
    recipe: Object.fromEntries(Object.entries(byRecipe).map(([k, a]) => [k, { avg: avg(a), n: a.length }])),
    liked: tags.filter(x => x.n >= 2 && x.avg >= 4).sort((a, b) => b.avg - a.avg || a.t.localeCompare(b.t)).map(x => x.t),
    meh: tags.filter(x => x.n >= 2 && x.avg <= 2.5).map(x => x.t)
  }
}
