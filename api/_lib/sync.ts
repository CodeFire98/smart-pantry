import { HttpError } from './http.js'
import { redis } from './redis.js'

/**
 * Production and development keep separate synced data, so testing locally (vercel dev / previews)
 * can never change the live kitchen. The Swiggy login keys are shared on purpose.
 */
export const syncPrefix = (env = process.env.VERCEL_ENV) => (env === 'production' ? 'sp:sync:' : 'sp-dev:sync:')
const P = syncPrefix()
export const SYNC = {
  kitchen: `${P}kitchen`,
  journal: `${P}journal`,
  recipes: `${P}recipes`,
  activity: `${P}activity`,
  photo: (key: string) => `${P}photo:${key}`
}

export const MAX_DOC = 900_000          // bytes of JSON per kitchen doc
export const MAX_PHOTO_B64 = 560_000    // ≈ 400 KB of JPEG
export const PHOTO_KEY = /^[A-Za-z0-9-]{8,80}$/

/**
 * Compare-and-set the kitchen document: write only if the stored rev still equals baseRev.
 * Returns the new rev, or the current stored value when someone else saved first.
 * Lua keeps the check and the write atomic on Redis.
 */
const CAS = `
local cur = redis.call('GET', KEYS[1])
local rev = 0
if cur then rev = cjson.decode(cur).rev or 0 end
if rev ~= tonumber(ARGV[2]) then return cur end
redis.call('SET', KEYS[1], ARGV[1])
return 'OK'`

export async function casKitchen(doc: unknown, baseRev: number): Promise<{ ok: true; rev: number } | { ok: false; current: { doc: unknown; rev: number } | null }> {
  const json = JSON.stringify({ doc, rev: baseRev + 1, savedAt: Date.now() })
  if (json.length > MAX_DOC) throw new HttpError(413, 'Your kitchen data is too large to sync.')
  const res = await redis().eval(CAS, [SYNC.kitchen], [json, String(baseRev)])
  if (res === 'OK') return { ok: true, rev: baseRev + 1 }
  const cur = typeof res === 'string' ? JSON.parse(res) : res
  return { ok: false, current: cur ? { doc: cur.doc, rev: cur.rev } : null }
}

/** Upsert records into a hash, keeping whichever copy has the larger timestamp. */
export async function upsertNewer<T>(hash: string, records: T[], key: (r: T) => string, time: (r: T) => number) {
  if (!records.length) return
  const keys = records.map(key)
  const existing = await redis().hmget<Record<string, T>>(hash, ...keys)
  const write: Record<string, string> = {}
  for (const r of records) {
    const cur = existing?.[key(r)] as T | string | null | undefined
    const parsed = typeof cur === 'string' ? JSON.parse(cur) as T : cur
    if (!parsed || time(r) >= time(parsed)) write[key(r)] = JSON.stringify(r)
  }
  if (Object.keys(write).length) await redis().hset(hash, write)
}

export async function readHash<T>(hash: string): Promise<T[]> {
  const all = await redis().hgetall<Record<string, T | string>>(hash)
  return Object.values(all ?? {}).map(v => (typeof v === 'string' ? JSON.parse(v) as T : v))
}

const ACTIVITY_TYPES = new Set(['search', 'open', 'cook', 'list', 'order', 'restock', 'scan', 'recipe'])
export const MAX_ACTIVITY = 4000
type Activity = { uid: string; t: number; type: string; text?: string; id?: string; names?: string[]; n?: number | null; r?: number }

/** Keep only well-formed events, with strings clipped. */
export function cleanActivity(list: unknown[]): Activity[] {
  const out: Activity[] = []
  for (const x of list as Array<Partial<Activity>>) {
    if (typeof x?.uid !== 'string' || !/^[A-Za-z0-9-]{8,64}$/.test(x.uid) || typeof x.t !== 'number' || !ACTIVITY_TYPES.has(String(x.type))) continue
    const e: Activity = { uid: x.uid, t: x.t, type: String(x.type) }
    if (typeof x.text === 'string') e.text = x.text.slice(0, 120)
    if (typeof x.id === 'string') e.id = x.id.slice(0, 60)
    if (Array.isArray(x.names)) e.names = x.names.filter((n): n is string => typeof n === 'string').slice(0, 40).map(n => n.slice(0, 60))
    if (typeof x.n === 'number' && Number.isFinite(x.n)) e.n = x.n
    out.push(e)
  }
  return out
}

/** Add new events (existing uids are left alone), stamped with the receive time; drop the oldest past MAX_ACTIVITY. */
export async function addActivity(list: Activity[], now = Date.now()) {
  if (!list.length) return
  const existing = await redis().hmget<Record<string, unknown>>(SYNC.activity, ...list.map(a => a.uid))
  const write: Record<string, string> = {}
  for (const a of list) if (existing?.[a.uid] == null) write[a.uid] = JSON.stringify({ ...a, r: now })
  if (!Object.keys(write).length) return
  await redis().hset(SYNC.activity, write)
  const n = await redis().hlen(SYNC.activity)
  if (n > MAX_ACTIVITY) {
    const all = await readHash<Activity>(SYNC.activity)
    const old = all.sort((a, b) => a.t - b.t).slice(0, n - MAX_ACTIVITY).map(a => a.uid)
    if (old.length) await redis().hdel(SYNC.activity, ...old)
  }
}

/** Events the server received after `since` (ms), oldest first. */
export async function activitySince(since: number): Promise<Activity[]> {
  return (await readHash<Activity>(SYNC.activity)).filter(a => (a.r ?? 0) > since).sort((a, b) => (a.r ?? 0) - (b.r ?? 0)).slice(0, 4000)
}
