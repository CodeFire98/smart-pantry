import type { Art, Recipe } from '../engine'

function hash(s: string) {
  let h = 2166136261
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619)
  return h >>> 0
}
function rng(seed: number) {
  let a = seed
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const PLATES = {
  steel: ['#B9C1C5', '#D7DDE0', 35],
  katori: ['#A9B2B6', '#C9D0D3', 33],
  ceramic: ['#F2ECE2', '#FBF8F2', 33],
  glass: ['#D5E2E8', '#ECF3F6', 30]
} as const

const cache = new Map<string, string>()

/**
 * Top-down illustration of a dish (steel thali, katori, ceramic plate or glass), drawn from the recipe's
 * `art` spec. Positions are seeded by the recipe id, so a dish always looks the same.
 * Colours come from schema-validated hex values; shape names outside the known set are ignored.
 */
export function plateSVG(r: Recipe): string {
  const hit = cache.get(r.id)
  if (hit) return hit
  const a: Art = r.art ?? { plate: 'ceramic', fill: '#E7CF9E', items: [['dice', 8, '#E8792B'], ['pea', 6], ['leaf', 4]] }
  const R = rng(hash(r.id))
  const [outer, inner, rc] = PLATES[a.plate] ?? PLATES.ceramic
  let s = `<svg class="plate" viewBox="0 0 100 100" aria-hidden="true"><ellipse cx="52" cy="54" rx="46" ry="46" fill="rgba(0,0,0,.14)"/><circle cx="50" cy="50" r="47" fill="${outer}"/><circle cx="50" cy="50" r="${a.plate === 'ceramic' ? 42 : 41}" fill="${inner}"/>`
  if (a.plate === 'steel' || a.plate === 'katori') s += `<path d="M18 30 A40 40 0 0 1 44 11" stroke="#fff" stroke-opacity=".55" stroke-width="2.4" fill="none" stroke-linecap="round"/>`
  s += `<circle cx="50" cy="50" r="${rc}" fill="${a.fill}"/>`
  if (a.plate === 'katori') s += `<circle cx="50" cy="50" r="${rc - 0.8}" fill="none" stroke="rgba(0,0,0,.16)" stroke-width="2.2"/>`
  if (a.plate === 'glass') s += `<circle cx="50" cy="50" r="${rc}" fill="none" stroke="rgba(255,255,255,.6)" stroke-width="1.5"/>`
  const pt = (rad: number) => { const t = R() * Math.PI * 2, d = Math.sqrt(R()) * rad; return [50 + Math.cos(t) * d, 50 + Math.sin(t) * d].map(n => n.toFixed(1)) }
  const rot = () => Math.round(R() * 180)
  const SH: Record<string, (x: string, y: string, c?: string) => string> = {
    grain: (x, y, c) => `<ellipse cx="${x}" cy="${y}" rx="2.3" ry=".9" fill="${c ?? '#FFF7E3'}" transform="rotate(${rot()} ${x} ${y})"/>`,
    pea: (x, y) => `<circle cx="${x}" cy="${y}" r="2.1" fill="#5FA83A"/><circle cx="${+x - 0.6}" cy="${+y - 0.6}" r=".6" fill="#B6E08F"/>`,
    dice: (x, y, c) => `<rect x="${+x - 1.8}" y="${+y - 1.8}" width="3.6" height="3.6" rx=".7" fill="${c ?? '#E8792B'}" transform="rotate(${rot()} ${x} ${y})"/>`,
    cube: (x, y, c) => `<g transform="rotate(${rot()} ${x} ${y})"><rect x="${+x - 3.4}" y="${+y - 3.4}" width="6.8" height="6.8" rx="1.2" fill="${c ?? '#FFF4DC'}" stroke="rgba(120,80,30,.35)" stroke-width=".7"/><path d="M${+x - 3} ${+y + 2.4}h6" stroke="rgba(190,120,40,.45)" stroke-width="1.1"/></g>`,
    tikka: (x, y, c) => `<g transform="rotate(${rot()} ${x} ${y})"><rect x="${+x - 3.6}" y="${+y - 3.6}" width="7.2" height="7.2" rx="1.4" fill="${c ?? '#E58A3A'}"/><path d="M${+x - 3} ${+y - 1}l6 -1.6M${+x - 3} ${+y + 2}l6 -1.6" stroke="#5A2A0E" stroke-width="1" opacity=".7"/></g>`,
    chunk: (x, y, c) => `<ellipse cx="${x}" cy="${y}" rx="4.2" ry="3.1" fill="${c ?? '#B97A45'}" stroke="rgba(60,25,5,.35)" stroke-width=".7" transform="rotate(${rot()} ${x} ${y})"/>`,
    wedge: (x, y, c) => `<rect x="${+x - 2.8}" y="${+y - 2.8}" width="5.6" height="5.6" rx="1.8" fill="${c ?? '#D99A3A'}" stroke="#8A5212" stroke-opacity=".5" stroke-width=".7" transform="rotate(${rot()} ${x} ${y})"/>`,
    egg_bits: (x, y, c) => `<ellipse cx="${x}" cy="${y}" rx="2.8" ry="1.9" fill="${R() > 0.4 ? (c ?? '#F6C344') : '#FFFBEA'}" transform="rotate(${rot()} ${x} ${y})"/>`,
    flake: (x, y) => `<circle cx="${x}" cy="${y}" r=".75" fill="#C0392B"/>`,
    pepperdot: (x, y) => `<circle cx="${x}" cy="${y}" r=".6" fill="#2A2420"/>`,
    seed: (x, y, c) => `<ellipse cx="${x}" cy="${y}" rx=".9" ry=".55" fill="${c ?? '#3A2A14'}" transform="rotate(${rot()} ${x} ${y})"/>`,
    peanut: (x, y, c) => `<ellipse cx="${x}" cy="${y}" rx="2" ry="1.3" fill="${c ?? '#E9C38A'}" stroke="rgba(120,70,20,.4)" stroke-width=".5" transform="rotate(${rot()} ${x} ${y})"/>`,
    leaf: (x, y) => `<ellipse cx="${x}" cy="${y}" rx="2.8" ry="1.4" fill="#3E8E3A" transform="rotate(${rot()} ${x} ${y})"/><ellipse cx="${+x + 1.6}" cy="${+y + 1}" rx="2" ry="1.1" fill="#57A84B" transform="rotate(${rot()} ${x} ${y})"/>`,
    petal: (x, y, c) => `<path d="M${+x - 4} ${y} q4 -3.5 8 0" stroke="${c ?? '#EADCC0'}" stroke-width="1.6" fill="none" stroke-linecap="round" transform="rotate(${rot()} ${x} ${y})"/>`,
    coin: (x, y, c) => `<circle cx="${x}" cy="${y}" r="4.2" fill="${c ?? '#F4E3A1'}" stroke="#D9BE5E" stroke-width=".8"/><circle cx="${x}" cy="${y}" r=".9" fill="#B89A3E"/>`,
    froth: (x, y, c) => `<circle cx="${x}" cy="${y}" r="${(1.5 + R() * 2.5).toFixed(1)}" fill="${c ?? '#F1DEC0'}" opacity=".75"/>`
  }
  for (const [type, count, color] of a.items) {
    if (type === 'swirl') { s += `<path d="M50 50 m-13 1 a13 10 0 1 0 26 0 a9 7 0 1 0 -18 0 a5 4 0 1 0 10 0" fill="none" stroke="${color ?? '#FBEBD0'}" stroke-width="2.6" stroke-linecap="round" opacity=".9"/>`; continue }
    if (type === 'egg') { s += `<path d="M44 40 q10 -9 20 -1 q8 7 1 16 q-8 9 -19 4 q-9 -6 -2 -19z" fill="#FFFDF5" stroke="rgba(0,0,0,.08)"/><circle cx="54" cy="49" r="5.6" fill="#F4AE1F"/><circle cx="52.4" cy="47.4" r="1.6" fill="#FFD66B"/>`; continue }
    if (type === 'halfegg') {
      for (let i = 0; i < count; i++) {
        const t = (i / count) * Math.PI * 2 + 0.4, x = (50 + Math.cos(t) * 15).toFixed(1), y = (50 + Math.sin(t) * 15).toFixed(1)
        s += `<ellipse cx="${x}" cy="${y}" rx="6.6" ry="5" fill="#FFFDF5" transform="rotate(${Math.round(t * 57)} ${x} ${y})"/><circle cx="${x}" cy="${y}" r="3.1" fill="#F4AE1F"/>`
      }
      continue
    }
    if (type === 'omelette') { s += `<path d="M22 56 a28 24 0 0 1 56 -4 z" fill="#F4C84A" stroke="#D9A42A" stroke-width="1"/><circle cx="38" cy="47" r="1.3" fill="#C98320"/><circle cx="55" cy="42" r="1.1" fill="#C98320"/><circle cx="64" cy="49" r="1.2" fill="#C98320"/><rect x="45" y="46" width="2.4" height="2.4" fill="#F7EEDC"/><rect x="58" y="50" width="2.2" height="2.2" fill="#F7EEDC"/>`; continue }
    if (type === 'toast') {
      for (const [x, y, d] of ([[66, 70, 14], [34, 70, -10]] as const).slice(0, count)) s += `<g transform="rotate(${d} ${x} ${y})"><rect x="${x - 10}" y="${y - 9}" width="20" height="18" rx="4" fill="#B5762F"/><rect x="${x - 8}" y="${y - 7}" width="16" height="14" rx="2.5" fill="#E2B067"/></g>`
      continue
    }
    if (type === 'sauce') { s += `<circle cx="24" cy="24" r="11" fill="#FFFFFF" stroke="rgba(0,0,0,.12)"/><circle cx="24" cy="24" r="8" fill="${color ?? '#C2361F'}"/><circle cx="21" cy="22" r="1.2" fill="#FF8A6B" opacity=".8"/>`; continue }
    if (type === 'bayleaf') { s += `<ellipse cx="38" cy="58" rx="9" ry="3.2" fill="#76863A" transform="rotate(-28 38 58)"/><path d="M30 62 L46 54" stroke="#55622A" stroke-width=".6"/>`; continue }
    if (type === 'momo') {
      const pos = [[50, 50], ...Array.from({ length: count - 1 }, (_, i) => { const t = (i / (count - 1)) * Math.PI * 2; return [50 + Math.cos(t) * 19, 52 + Math.sin(t) * 17] })]
      for (const [x, y] of pos) s += `<ellipse cx="${x + 1}" cy="${y + 3}" rx="7.4" ry="6" fill="#B9802F" opacity=".75"/><circle cx="${x}" cy="${y}" r="7" fill="#F5EEDF" stroke="#D8CAB0" stroke-width=".8"/><path d="M${x - 4} ${y - 1} q4 -5 8 0 M${x - 2.5} ${y - 3} l2.5 3 l2.5 -3" stroke="#D2C3A6" stroke-width=".8" fill="none"/>`
      continue
    }
    const f = SH[type]
    if (!f) continue
    const lim = type === 'grain' ? rc - 2 : rc - 5
    for (let i = 0; i < Math.min(count, 80); i++) { const [x, y] = pt(lim); s += f(x, y, color) }
  }
  s += '</svg>'
  cache.set(r.id, s)
  return s
}
