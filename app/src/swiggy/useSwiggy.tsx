import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { api, ApiError, type Status } from './api'

interface SwiggyState {
  status: Status | null
  /** Logged in to the app, connected to Swiggy and an address picked. */
  ready: boolean
  refresh: () => Promise<void>
  /** Turn an API error into a user message, refreshing status when the session or Swiggy login is gone. */
  explain: (e: unknown) => string
}

const Ctx = createContext<SwiggyState>({ status: null, ready: false, refresh: async () => {}, explain: () => '' })
export const useSwiggy = () => useContext(Ctx)

export function SwiggyProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status | null>(null)
  const refresh = useCallback(async () => {
    try { setStatus(await api.status()) } catch { setStatus(null) }
  }, [])
  useEffect(() => { refresh() }, [refresh])
  const explain = useCallback((e: unknown) => {
    if (e instanceof ApiError) {
      if (e.status === 401) refresh()
      return e.message
    }
    return 'Something went wrong. Try again.'
  }, [refresh])
  const ready = !!(status?.authed && status.swiggy?.connected && status.swiggy.address)
  return <Ctx.Provider value={{ status, ready, refresh, explain }}>{children}</Ctx.Provider>
}
