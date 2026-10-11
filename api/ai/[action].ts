import { PROMPTS, checkDailyCap, generateJson, usageToday, type KitchenContext } from '../_lib/ai.js'
import { HttpError, body, route, str } from '../_lib/http.js'
import { requireSession } from '../_lib/session.js'

const MAX_IMAGE_B64 = 1_400_000   // ≈ 1 MB JPEG (the app sends ~1280px photos, far smaller)

function context(b: Record<string, unknown>): KitchenContext {
  const c = (b.context ?? {}) as Partial<KitchenContext>
  const arr = <T,>(v: unknown) => (Array.isArray(v) ? v as T[] : [])
  return {
    catalog: arr<KitchenContext['catalog'][number]>(c.catalog).filter(i => typeof i?.id === 'string'),
    inStock: arr<KitchenContext['inStock'][number]>(c.inStock).filter(i => typeof i?.id === 'string'),
    expiring: arr<string>(c.expiring).filter(x => typeof x === 'string'),
    equipment: arr<string>(c.equipment).filter(x => typeof x === 'string'),
    journal: arr<KitchenContext['journal'][number]>(c.journal).filter(j => typeof j?.dish === 'string'),
    dishes: arr<string>(c.dishes).filter(x => typeof x === 'string'),
    profile: typeof c.profile === 'string' ? c.profile.slice(0, 3000) : undefined
  }
}
const asArray = (v: unknown) => (Array.isArray(v) ? v : [])

/**
 * POST /api/ai/suggest {context}            → {recipes: [...]}   (3 new dishes)
 * POST /api/ai/draft   {context, request}   → {recipe}
 * POST /api/ai/parse   {context, text}      → {filters}
 * POST /api/ai/scan    {context, kind, image(base64 JPEG)} → {items}
 * POST /api/ai/profile {activity (text summary), current?: {text, by}} → {markdown}
 * GET  /api/ai/usage → {used, cap, model}
 * Passcode-gated and capped per day. Replies are shape-checked here and validated again in the app.
 */
export default route(['GET', 'POST'], async req => {
  requireSession(req)
  const action = String(req.query.action)
  if (req.method === 'GET') {
    if (action !== 'usage') throw new HttpError(404, 'Unknown action')
    return usageToday()
  }
  const b = body<Record<string, unknown>>(req)
  if (!['suggest', 'draft', 'parse', 'scan', 'profile'].includes(action)) throw new HttpError(404, 'Unknown action')
  await checkDailyCap()
  const c = context(b)

  if (action === 'suggest') {
    const p = PROMPTS.suggest(c)
    const out = await generateJson<{ recipes?: unknown[] }>(p.prompt, { schema: p.schema, thinking: p.thinking, temperature: 0.9 })
    return { recipes: asArray(out.recipes).slice(0, 3) }
  }
  if (action === 'draft') {
    const p = PROMPTS.draft(c, str(b.request, 'dish', 120))
    return { recipe: await generateJson<unknown>(p.prompt, { schema: p.schema, thinking: p.thinking }) }
  }
  if (action === 'parse') {
    const tags = asArray(b.tags).filter((t): t is string => typeof t === 'string')
    const p = PROMPTS.parse({ catalog: c.catalog, dishes: c.dishes, tags }, str(b.text, 'request', 300))
    return { filters: await generateJson<unknown>(p.prompt, { schema: p.schema, thinking: p.thinking, temperature: 0.2 }) }
  }
  if (action === 'profile') {
    const cur = b.current as { text?: unknown; by?: unknown } | undefined
    const current = cur && typeof cur.text === 'string' && cur.text.trim() ? { text: cur.text, by: cur.by === 'you' ? 'you' : 'ai' } : null
    const p = PROMPTS.profile(str(b.activity, 'activity', 12000), current)
    const out = await generateJson<{ markdown?: unknown }>(p.prompt, { schema: p.schema, thinking: p.thinking, temperature: 0.4 })
    if (typeof out.markdown !== 'string' || !out.markdown.trim()) throw new HttpError(502, 'The AI replied in an unexpected format. Try again.')
    return { markdown: out.markdown.trim().slice(0, 4000) }
  }
  // scan
  const kind = b.kind === 'shelf' ? 'shelf' : 'bill'
  const image = b.image
  if (typeof image !== 'string' || !/^[A-Za-z0-9+/=]+$/.test(image)) throw new HttpError(400, 'Send a JPEG photo.')
  if (image.length > MAX_IMAGE_B64) throw new HttpError(413, 'That photo is too large.')
  const p = PROMPTS.scan(c, kind)
  const out = await generateJson<{ items?: unknown[] }>(p.prompt + p.catalogNote, { schema: p.schema, thinking: p.thinking, temperature: 0.1, images: [image] })
  return { items: asArray(out.items).slice(0, 80) }
})
