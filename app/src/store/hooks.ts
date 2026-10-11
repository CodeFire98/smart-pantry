import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useState } from 'react'
import type { JournalEntry, Kitchen, Recipe } from '../engine'
import { allRecipes, catalogWith, db, ensureKitchen } from './db'
import { fetchPhoto } from './sync'

const fetching = new Set<string>()

const EMPTY_J: JournalEntry[] = []
const EMPTY_R: Recipe[] = []

export function useData() {
  useEffect(() => { ensureKitchen() }, [])
  const kitchen = useLiveQuery(async () => (await db.kv.get('kitchen'))?.value as Kitchen | undefined, [])
  const journal = useLiveQuery(async () => (await db.journal.orderBy('at').reverse().toArray()).filter(j => !j.deletedAt), [], EMPTY_J)
  // Photos of entries logged on another device arrive as a server key; fetch each once.
  useEffect(() => {
    for (const j of journal) if (j.photo && j.photoId == null && j.id != null && !fetching.has(j.photo)) {
      fetching.add(j.photo)
      fetchPhoto(j.id, j.photo).catch(e => console.warn('[sync] photo fetch failed', e)).finally(() => fetching.delete(j.photo!))
    }
  }, [journal])
  const custom = useLiveQuery(() => db.recipes.toArray(), [], EMPTY_R)
  const catalog = useMemo(() => catalogWith(custom, kitchen), [custom, kitchen?.customIngredients]) // eslint-disable-line react-hooks/exhaustive-deps
  const recipes = useMemo(() => allRecipes(custom), [custom])
  return { kitchen, journal, catalog, recipes }
}

/** Object URL for a stored photo, revoked on unmount. */
export function usePhotoUrl(photoId: number | undefined): string | null {
  const blob = useLiveQuery(async () => (photoId != null ? (await db.photos.get(photoId))?.blob ?? null : null), [photoId], null)
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!blob) { setUrl(null); return }
    const u = URL.createObjectURL(blob)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [blob])
  return url
}

/** Downscale a picked photo to a JPEG no wider/taller than `max` px. */
export function shrinkPhoto(file: File, max = 1280, quality = 0.82): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image(), src = URL.createObjectURL(file)
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.width, img.height))
      const c = document.createElement('canvas')
      c.width = Math.round(img.width * s); c.height = Math.round(img.height * s)
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
      URL.revokeObjectURL(src)
      c.toBlob(b => (b ? resolve(b) : reject(new Error('encode'))), 'image/jpeg', quality)
    }
    img.onerror = () => { URL.revokeObjectURL(src); reject(new Error('decode')) }
    img.src = src
  })
}
