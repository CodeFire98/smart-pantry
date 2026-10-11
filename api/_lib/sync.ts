import { HttpError } from './http.js'
import { redis } from './redis.js'

export const SYNC = {
  kitchen: 'sp:sync:kitchen',
  journal: 'sp:sync:journal',
  recipes: 'sp:sync:recipes',
  photo: (key: string) => `sp:sync:photo:${key}`
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
