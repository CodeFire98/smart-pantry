import type { Catalog, Energy, Kitchen, Recipe, Tier } from './types'

export interface SlotAlt { id: string; q: number | null }
export interface Slot { opt: boolean; alts: SlotAlt[]; main: string; need: number | null }

/** "?id:qty|alt:qty" → slot. `?` marks optional; `|` lists accepted substitutes, first is preferred. */
export function parseSlot(s: string): Slot {
  const opt = s.startsWith('?')
  const alts = s.replace('?', '').split('|').map(a => {
    const [id, q] = a.split(':')
    return { id, q: q ? Number(q) : null }
  })
  return { opt, alts, main: alts[0].id, need: alts[0].q }
}

export interface Have {
  ok: boolean
  id?: string
  /** Quantity available (if short) or quantity that will be used. */
  q?: number
  need?: number
  low?: boolean
  unsure?: boolean
  sub?: boolean
}

export function haveAlt(a: SlotAlt, kitchen: Kitchen, catalog: Catalog): Have {
  const it = kitchen.items[a.id]
  const ing = catalog[a.id]
  if (!it || !ing) return { ok: false }
  if (ing.unit) {
    const need = a.q ?? 1, q = it.q ?? 0
    if (q >= need) return { ok: true, id: a.id, q: need }
    if (q > 0) return { ok: true, low: true, id: a.id, q, need }
    return { ok: false }
  }
  const l = it.l ?? 0
  if (l <= 0) return { ok: false }
  return { ok: true, id: a.id, low: l === 1, unsure: !!it.unsure }
}

/** Best match for a slot: a fully stocked alternative beats a short one. */
export function have(slot: Slot, kitchen: Kitchen, catalog: Catalog): Have {
  let short: Have | null = null
  for (const a of slot.alts) {
    const h = haveAlt(a, kitchen, catalog)
    if (h.ok && !h.low) return { ...h, sub: a.id !== slot.main }
    if (h.ok && !short) short = { ...h, sub: a.id !== slot.main }
  }
  return short ?? { ok: false }
}

/** Tiers are cumulative: tier i needs every slot of tiers 0..i. */
export const tierSlots = (r: Recipe, i: number): Slot[] => r.tiers.slice(0, i + 1).flatMap(t => t.add.map(parseSlot))

export function missing(r: Recipe, i: number, kitchen: Kitchen, catalog: Catalog): string[] {
  return tierSlots(r, i).filter(sl => !sl.opt && !have(sl, kitchen, catalog).ok).map(sl => sl.main)
}

export function equipMissing(r: Recipe, i: number, kitchen: Kitchen): string[] {
  const needs = new Set(r.tiers.slice(0, i + 1).flatMap(t => t.needs ?? []))
  return [...needs].filter(e => !kitchen.equipment.includes(e))
}

export const cookable = (r: Recipe, i: number, kitchen: Kitchen, catalog: Catalog) =>
  missing(r, i, kitchen, catalog).length === 0 && equipMissing(r, i, kitchen).length === 0

export const ENERGY: Record<Energy, { effort: number; mins: number; name: string }> = {
  1: { effort: 1, mins: 15, name: 'Low' },
  2: { effort: 2, mins: 30, name: 'Medium' },
  3: { effort: 3, mins: Infinity, name: 'High' }
}

export const fits = (t: Tier, energy: Energy) => t.effort <= ENERGY[energy].effort && t.mins <= ENERGY[energy].mins
