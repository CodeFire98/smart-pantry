import { HttpError } from './http.js'
import { redis } from './redis.js'

/**
 * AI helper calls (Gemini free tier today; AI_PROVIDER leaves room for Claude later).
 * AI only drafts things the user reviews — it never ranks dishes.
 */
const MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash'
const FALLBACK_MODEL = 'gemini-flash-latest'
/**
 * Free-tier guardrails. The key's Google project has no billing account, so Google can only refuse
 * (never charge) past its free limits. These caps keep us well under those limits anyway:
 * at most AI_DAILY_CAP calls per day and AI_MINUTE_CAP per minute, only free Flash models, small images.
 */
export const DAILY_CAP = Number(process.env.AI_DAILY_CAP || 100)
export const MINUTE_CAP = Number(process.env.AI_MINUTE_CAP || 5)
export const ALLOWED_MODELS = /^gemini-[0-9.]*-?flash(-lite)?(-latest)?$|^gemini-flash(-lite)?-latest$/

export async function checkDailyCap(now = new Date()): Promise<void> {
  const day = `sp:ai:count:${now.toISOString().slice(0, 10)}`
  const minute = `sp:ai:minute:${now.toISOString().slice(0, 16)}`
  const [d, m] = await Promise.all([redis().incr(day), redis().incr(minute)])
  if (d === 1) await redis().expire(day, 2 * 86400)
  if (m === 1) await redis().expire(minute, 120)
  if (m > MINUTE_CAP) throw new HttpError(429, 'Too many AI requests in a minute. Wait a moment and try again.', { reason: 'ai_cap' })
  if (d > DAILY_CAP) throw new HttpError(429, `AI limit reached for today (${DAILY_CAP} requests). It resets at midnight UTC.`, { reason: 'ai_cap' })
}

/** Today's usage, for the app's AI status line. */
export async function usageToday(now = new Date()) {
  const used = Number(await redis().get(`sp:ai:count:${now.toISOString().slice(0, 10)}`) ?? 0)
  return { used, cap: DAILY_CAP, model: MODEL }
}

type Part = { text: string } | { inlineData: { mimeType: string; data: string } }

export interface GenOptions { schema: Record<string, unknown>; thinking?: 'low' | 'medium' | 'high'; images?: string[]; temperature?: number }

/** One structured-JSON call. Retries once on Gemini's "high demand" (503) with the fallback model. */
export async function generateJson<T>(prompt: string, opts: GenOptions): Promise<T> {
  if ((process.env.AI_PROVIDER ?? 'gemini') !== 'gemini') throw new HttpError(503, 'Only Gemini is set up as the AI provider.')
  const key = process.env.GEMINI_API_KEY
  if (!key) throw new HttpError(503, 'AI isn’t set up on the server yet (GEMINI_API_KEY).', { reason: 'ai_off' })
  // Only Flash models: they're on Gemini's free tier. Anything else is refused rather than risking a paid model.
  if (!ALLOWED_MODELS.test(MODEL)) throw new HttpError(503, `AI model ${MODEL} isn’t allowed (only free Flash models).`, { reason: 'ai_off' })
  const parts: Part[] = [{ text: prompt }, ...(opts.images ?? []).map(data => ({ inlineData: { mimeType: 'image/jpeg', data } }))]
  const body = {
    contents: [{ role: 'user', parts }],
    generationConfig: {
      responseMimeType: 'application/json', responseSchema: opts.schema,
      temperature: opts.temperature ?? 0.7,
      thinkingConfig: { thinkingLevel: opts.thinking ?? 'low' }
    }
  }
  const deadline = Date.now() + 100_000   // function maxDuration is 120 s
  for (const model of [MODEL, FALLBACK_MODEL]) {
    const left = deadline - Date.now()
    if (left < 10_000) break
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), Math.min(60_000, left))
    let r: Response
    try {
      r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST', signal: ctl.signal,
        headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
        body: JSON.stringify(model === MODEL ? body : { ...body, generationConfig: { ...body.generationConfig, thinkingConfig: undefined } })
      })
    } catch {
      clearTimeout(timer)
      if (model === MODEL) continue
      throw new HttpError(504, 'The AI took too long to answer. Try again.')
    }
    clearTimeout(timer)
    const j = await r.json().catch(() => ({})) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>; error?: { message?: string; status?: string } }
    if (r.status === 503) { if (model === MODEL) continue; break }
    if (r.status === 429) throw new HttpError(429, 'Gemini’s free limit is used up for now. Try again later.', { reason: 'ai_quota' })
    if (!r.ok) {
      console.error('[ai] gemini error', r.status, j.error?.status)
      throw new HttpError(502, 'The AI couldn’t answer right now. Try again.')
    }
    const text = j.candidates?.[0]?.content?.parts?.map(p => p.text ?? '').join('') ?? ''
    try { return JSON.parse(text) as T } catch { throw new HttpError(502, 'The AI replied in an unexpected format. Try again.') }
  }
  throw new HttpError(503, 'Gemini is busy right now. Try again in a minute.')
}

/* ---------- prompts & schemas ---------- */

export interface KitchenContext {
  catalog: Array<{ id: string; name: string; unit: string | null }>
  inStock: Array<{ id: string; amount: string }>
  expiring: string[]
  equipment: string[]
  journal: Array<{ dish: string; version: string; rating: number | null; note: string }>
  dishes: string[]
  /** "About my cooking" markdown: the cook's taste profile. */
  profile?: string
}

const clip = (s: unknown, n: number) => String(s ?? '').slice(0, n)

export function contextText(c: KitchenContext): string {
  return [
    'COOK: cooks for one person. Prefers vegetarian and egg dishes; chicken occasionally. No allergies. Indian home cook who also likes Indo-Chinese flavours.',
    `EQUIPMENT: ${c.equipment.slice(0, 12).map(e => clip(e, 30)).join(', ')}. Nothing else (no oven, microwave, blender or pressure cooker unless listed).`,
    `IN STOCK: ${c.inStock.slice(0, 120).map(i => `${clip(i.id, 40)} (${clip(i.amount, 20)})`).join(', ')}`,
    `USE SOON: ${c.expiring.slice(0, 20).map(e => clip(e, 40)).join(', ') || 'nothing'}`,
    `COOKING JOURNAL (newest first):\n${c.journal.slice(0, 25).map(j => `- ${clip(j.dish, 60)} (${clip(j.version, 30)})${j.rating ? ` ${j.rating}/5` : ''}${j.note ? `: "${clip(j.note, 160)}"` : ''}`).join('\n') || '- nothing logged yet'}`,
    ...(c.profile?.trim() ? [`TASTE PROFILE (what this cook likes, written from their activity; follow it):\n${clip(c.profile, 2000)}`] : []),
    `EXISTING DISHES (don't repeat): ${c.dishes.slice(0, 120).map(d => clip(d, 60)).join('; ')}`,
    `INGREDIENT CATALOG (id [unit]): ${c.catalog.slice(0, 250).map(i => `${clip(i.id, 40)} [${i.unit ?? 'level'}]`).join(', ')}`
  ].join('\n')
}

const RECIPE_RULES = `Each recipe has 2-3 cumulative versions, simplest first (each version lists only the ingredients it ADDS to the previous one).
Use ingredient ids from the catalog whenever possible, with amounts for ONE serving in the catalog unit (amount 0 for level-tracked items like spices and oils).
For an ingredient not in the catalog, invent an id starting with "new_" and also list it under newIngredients.
Times must be honest for one person cooking with only the listed equipment. Steps: 2-3 short imperative steps per version.
The simplest version should be cookable from what is in stock whenever possible.`

const ING = { type: 'OBJECT', properties: { id: { type: 'STRING' }, amount: { type: 'NUMBER' }, optional: { type: 'BOOLEAN' }, substitute: { type: 'STRING' } }, required: ['id', 'amount'] }
const RECIPE = {
  type: 'OBJECT',
  properties: {
    name: { type: 'STRING' }, why: { type: 'STRING' },
    meals: { type: 'ARRAY', items: { type: 'STRING', enum: ['breakfast', 'lunch', 'snack', 'dinner'] } },
    tags: { type: 'ARRAY', items: { type: 'STRING' } },
    plate: { type: 'STRING', enum: ['steel', 'katori', 'ceramic', 'glass'] },
    color: { type: 'STRING', description: 'hex colour of the dish, e.g. #C9772E' },
    tiers: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
      name: { type: 'STRING', description: 'short version name, 1-3 words (e.g. Basic, Masala, Loaded with egg)' }, mins: { type: 'INTEGER' }, effort: { type: 'INTEGER', description: '1 easy, 2 some, 3 lots' },
      ingredients: { type: 'ARRAY', items: ING }, steps: { type: 'ARRAY', items: { type: 'STRING' } }
    }, required: ['name', 'mins', 'effort', 'ingredients', 'steps'] } },
    newIngredients: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
      id: { type: 'STRING' }, name: { type: 'STRING' }, unit: { type: 'STRING', enum: ['pc', 'g', 'ml', 'level'] },
      cat: { type: 'STRING', enum: ['fridge', 'fresh', 'freezer', 'shelf', 'spices', 'sauces'] }
    }, required: ['id', 'name', 'unit', 'cat'] } }
  },
  required: ['name', 'why', 'meals', 'tags', 'plate', 'color', 'tiers', 'newIngredients']
}

export const PROMPTS = {
  suggest: (c: KitchenContext) => ({
    prompt: `You help a home cook decide what to cook next. Suggest 3 NEW dishes they would enjoy, guided by their ratings and notes, that mostly use what is in stock (especially USE SOON items).\n${RECIPE_RULES}\n\n${contextText(c)}`,
    schema: { type: 'OBJECT', properties: { recipes: { type: 'ARRAY', items: RECIPE } }, required: ['recipes'] },
    thinking: 'low' as const
  }),
  draft: (c: KitchenContext, request: string) => ({
    prompt: `Write a recipe for "${clip(request, 120)}" for this home cook, adapted to their kitchen and diet. If the request is vague, pick the most fitting dish.\n${RECIPE_RULES}\n\n${contextText(c)}`,
    schema: RECIPE,
    thinking: 'medium' as const
  }),
  parse: (c: Pick<KitchenContext, 'catalog' | 'dishes'> & { tags: string[] }, text: string) => ({
    prompt: `Turn this food request into search filters for a recipe app. Only use dish names from DISHES, tags from TAGS and ingredient ids from CATALOG (leave arrays empty when unsure).\nREQUEST: "${clip(text, 300)}"\nDISHES: ${c.dishes.slice(0, 150).map(d => clip(d, 60)).join('; ')}\nTAGS: ${c.tags.slice(0, 40).join(', ')}\nCATALOG: ${c.catalog.slice(0, 250).map(i => `${clip(i.id, 40)} (${clip(i.name, 40)})`).join(', ')}`,
    schema: { type: 'OBJECT', properties: {
      dishes: { type: 'ARRAY', items: { type: 'STRING' } }, tags: { type: 'ARRAY', items: { type: 'STRING' } },
      ingredients: { type: 'ARRAY', items: { type: 'STRING' } }, maxMins: { type: 'INTEGER', description: '0 if not mentioned' },
      meal: { type: 'STRING', enum: ['any', 'breakfast', 'lunch', 'snack', 'dinner'] }, energy: { type: 'STRING', enum: ['any', 'low', 'medium', 'high'] },
      summary: { type: 'STRING', description: 'a few words describing what was understood' }
    }, required: ['dishes', 'tags', 'ingredients', 'maxMins', 'meal', 'energy', 'summary'] },
    thinking: 'low' as const
  }),
  profile: (activity: string, current: { text: string; by: string } | null) => ({
    prompt: `Write a short "About my cooking" profile for a home cook, in the first person ("I"), from what they actually did in their pantry app. It is read by an AI before suggesting or writing recipes for them, and by the cook, so be specific and useful: name dishes, ingredients, versions and times. Only state patterns the data supports; with little data, say less. No invented facts, no health advice.
Format: GitHub markdown, at most 220 words, exactly these headings, each with 2-5 short bullets:
## What I love
## How I cook
## What I buy
## Try next
Facts that always hold (put each in the bullet it fits, once, briefly): cooks for one; vegetarian and egg dishes are the staples, chicken occasionally; no allergies; induction cooktop, stainless kadai and saucepan. Don't fill sections with "nothing recorded" lines: if there's no data for a section, give 1 sensible bullet from these facts.
${current ? `CURRENT PROFILE (${current.by === 'you' ? 'edited by the cook: keep what they wrote unless the activity clearly contradicts it' : 'written by you earlier: update it'}):\n${clip(current.text, 3000)}\n` : ''}
ACTIVITY:
${clip(activity, 9000)}`,
    schema: { type: 'OBJECT', properties: { markdown: { type: 'STRING' } }, required: ['markdown'] },
    thinking: 'low' as const
  }),
  scan: (c: Pick<KitchenContext, 'catalog'>, kind: 'bill' | 'shelf') => ({
    prompt: kind === 'bill'
      ? `This is a grocery bill or delivery receipt. List every FOOD item bought with its quantity (count of packs, and pack size if printed). Skip non-food items, fees and taxes.`
      : `This is a photo of a fridge, shelf or pantry. List the FOOD items you can clearly see with a rough quantity (pieces, or approximate grams/ml if it's a pack). Don't guess hidden items.`,
    schema: { type: 'OBJECT', properties: { items: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
      name: { type: 'STRING' }, catalogId: { type: 'STRING', description: 'matching id from CATALOG, or empty' },
      packs: { type: 'NUMBER', description: 'how many packs or pieces (the bill quantity)' }, size: { type: 'NUMBER', description: 'amount in ONE pack, in unit (e.g. 1000 for a 1 L milk pack, 12 for a tray of 12 eggs); 0 if unknown' },
      unit: { type: 'STRING', enum: ['pc', 'g', 'ml', 'unknown'] }
    }, required: ['name', 'catalogId', 'packs', 'size', 'unit'] } } }, required: ['items'] },
    thinking: 'low' as const,
    catalogNote: `\nCATALOG (id: name): ${c.catalog.slice(0, 250).map(i => `${clip(i.id, 40)}: ${clip(i.name, 40)}`).join(', ')}`
  })
}
