import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect } from 'react'
import { profileDue, summarizeActivity, summaryText, type Kitchen } from '../engine'
import { allActivity } from '../store/activity'
import { db, updateKitchen } from '../store/db'
import { ai } from './api'

/** Ask the AI to (re)write "About my cooking" from the activity log and the journal. One AI call. */
export async function refreshProfile(kitchen: Kitchen): Promise<void> {
  const [events, journal] = await Promise.all([allActivity(), db.journal.toArray()])
  const text = summaryText(summarizeActivity(events, journal))
  const cur = kitchen.profile
  const { markdown } = await ai.profile(text, cur ? { text: cur.text, by: cur.by } : null)
  await updateKitchen(k => ({ ...k, profile: { text: markdown, at: Date.now(), by: 'ai', events: events.length } }))
}

/** Save the cook's own edit. The next AI refresh keeps what they wrote. */
export async function saveProfileText(text: string): Promise<void> {
  await updateKitchen(k => ({ ...k, profile: { text: text.trim(), at: Date.now(), by: 'you', events: k.profile?.events ?? 0 } }))
}

export const useActivityCount = () => useLiveQuery(() => db.activity.count(), [], 0)

let autoTried = false
/** Once per app session: rewrite the profile if it's due (first time after 10 actions, then weekly). Silent on failure. */
export function useProfileAuto(kitchen: Kitchen | undefined) {
  const count = useActivityCount()
  useEffect(() => {
    if (autoTried || !kitchen || !navigator.onLine || !profileDue(kitchen.profile, count)) return
    autoTried = true
    const t = window.setTimeout(() => { refreshProfile(kitchen).catch(() => {}) }, 8000)   // after startup sync settles
    return () => window.clearTimeout(t)
  }, [kitchen, count])
}
