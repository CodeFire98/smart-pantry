import { useSyncExternalStore } from 'react'
import { isoDate, isPristine, kitchenFromSeed, mergeJournal, mergeKitchen, mergeRecipes, stampPreSync, type JournalEntry, type Kitchen, type RecipeRecord } from '../engine'
import { onChange } from './changes'
import { db, putSyncedKitchen, readKitchen } from './db'

export type SyncState = { status: 'idle' | 'syncing' | 'synced' | 'offline' | 'locked' | 'error'; at: number | null; message?: string }

let state: SyncState = { status: 'idle', at: null }
const subs = new Set<() => void>()
const set = (s: Partial<SyncState>) => { state = { ...state, ...s }; subs.forEach(f => f()) }
export const useSyncState = () => useSyncExternalStore(cb => { subs.add(cb); return () => { subs.delete(cb) } }, () => state)

class HttpStatus extends Error { constructor(public status: number, public data: Record<string, unknown>) { super(String(status)) } }
async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, { credentials: 'same-origin', ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new HttpStatus(r.status, data)
  return data as T
}

const kv = async <T,>(key: string) => (await db.kv.get(key))?.value as T | undefined
const setKv = (key: string, value: unknown) => db.kv.put({ key, value })

/** Blob → base64 (no data: prefix). */
const toB64 = (b: Blob) => new Promise<string>((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1] ?? ''); fr.onerror = rej; fr.readAsDataURL(b) })

/** Downscale for the server copy (~960px JPEG); the phone keeps its 1280px original. */
async function forUpload(blob: Blob): Promise<Blob> {
  const bmp = await createImageBitmap(blob)
  const s = Math.min(1, 960 / Math.max(bmp.width, bmp.height))
  const c = document.createElement('canvas'); c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s)
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height)
  return new Promise((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('encode'))), 'image/jpeg', 0.78))
}

let running: Promise<void> | null = null
let again = false

/** Pull, merge, push. Safe to call any time; concurrent calls coalesce into one follow-up run. */
export function syncNow(): Promise<void> {
  if (running) { again = true; return running }
  running = (async () => {
    try {
      do { again = false; await syncOnce() } while (again)
    } finally { running = null }
  })()
  return running
}

async function syncOnce(attempt = 0): Promise<void> {
  if (!navigator.onLine) return set({ status: 'offline' })
  set({ status: 'syncing' })
  try {
    const remote = await call<{ kitchen: { doc: Kitchen; rev: number } | null; journal: JournalEntry[]; recipes: RecipeRecord[] }>('/api/sync')
    // Kitchen: a device that still has only the starting pantry adopts the server copy; otherwise merge.
    let local = await readKitchen()
    if (!(await kv<boolean>('sync:started'))) {
      // First sync on this device: edits made before sync existed have no timestamps yet.
      local = stampPreSync(local, kitchenFromSeed(isoDate()), Date.now())
      await putSyncedKitchen(local)
      await setKv('sync:started', true)
    }
    let kitchen = local
    if (remote.kitchen) kitchen = isPristine(local) ? remote.kitchen.doc : mergeKitchen(local, remote.kitchen.doc)
    const kitchenChanged = !remote.kitchen || JSON.stringify(kitchen) !== JSON.stringify(remote.kitchen.doc)
    if (JSON.stringify(kitchen) !== JSON.stringify(local)) await putSyncedKitchen(kitchen)

    // Journal + recipes: per record, newest edit wins.
    const localJ = await db.journal.toArray()
    const j = mergeJournal(localJ, remote.journal)
    for (const e of j.toPull) {
      const mine = localJ.find(x => x.uid === e.uid)
      const keepPhoto = mine && mine.photo === e.photo ? { photoId: mine.photoId } : {}
      if (mine?.photoId != null && mine.photo !== e.photo) await db.photos.delete(mine.photoId)
      if (mine) await db.journal.put({ ...e, id: mine.id, ...keepPhoto })
      else await db.journal.add({ ...e, id: undefined, photoId: undefined })
    }
    const r = mergeRecipes(await db.recipes.toArray(), remote.recipes)
    if (r.toPull.length) await db.recipes.bulkPut(r.toPull)

    // Push. A 409 means another device saved the kitchen in between: pull + merge again (once).
    try {
      await call('/api/sync', { method: 'POST', body: JSON.stringify({
        kitchen: kitchenChanged ? { doc: kitchen, baseRev: remote.kitchen?.rev ?? 0 } : undefined,
        journal: j.toPush, recipes: r.toPush
      }) })
    } catch (e) {
      if (e instanceof HttpStatus && e.status === 409 && attempt < 2) return syncOnce(attempt + 1)
      throw e
    }
    await uploadPhotos()
    set({ status: 'synced', at: Date.now(), message: undefined })
  } catch (e) {
    if (e instanceof HttpStatus && e.status === 401) return set({ status: 'locked', message: 'Unlock the app to sync.' })
    if (e instanceof HttpStatus && e.status === 503) return set({ status: 'error', message: 'Sync storage isn’t set up on the server.' })
    if (!navigator.onLine || e instanceof TypeError) return set({ status: 'offline' })
    set({ status: 'error', message: 'Couldn’t sync. Will retry.' })
  }
}

/** Upload photos this device has that the server doesn't yet. */
async function uploadPhotos() {
  const done = new Set((await kv<string[]>('sync:uploadedPhotos')) ?? [])
  const pending = (await db.journal.toArray()).filter(j => j.photo && j.photoId != null && !j.deletedAt && !done.has(j.photo))
  for (const j of pending) {
    const p = await db.photos.get(j.photoId!)
    if (!p) continue
    try {
      await call(`/api/photo/${j.photo}`, { method: 'PUT', body: JSON.stringify({ data: await toB64(await forUpload(p.blob)) }) })
      done.add(j.photo!)
      await setKv('sync:uploadedPhotos', [...done])
    } catch { /* try again on the next sync */ }
  }
}

/** Fetch a journal photo from the server into this device (for entries logged on another device). */
export async function fetchPhoto(entryId: number, key: string): Promise<void> {
  const r = await fetch(`/api/photo/${key}`, { credentials: 'same-origin' })
  if (!r.ok) return
  const blob = await r.blob()
  await db.transaction('rw', db.journal, db.photos, db.kv, async () => {
    const j = await db.journal.get(entryId)
    if (!j || j.photo !== key || j.photoId != null) return
    const photoId = await db.photos.add({ blob, at: Date.now() })
    await db.journal.update(entryId, { photoId })
    const done = new Set((await kv<string[]>('sync:uploadedPhotos')) ?? []); done.add(key)
    await setKv('sync:uploadedPhotos', [...done])
  })
}

let timer: number | undefined
/** Start syncing: now, when the app comes back to the foreground or online, and 2 s after local edits. */
export function startSync() {
  syncNow()
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncNow() })
  window.addEventListener('online', () => syncNow())
  window.addEventListener('offline', () => set({ status: 'offline' }))
  onChange(() => { window.clearTimeout(timer); timer = window.setTimeout(() => syncNow(), 2000) })
}
