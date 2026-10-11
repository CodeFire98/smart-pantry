import { useCallback } from 'react'
import { ApiError } from '../swiggy/api'
import { useApp } from '../ui/AppContext'
import { kitchenContext } from './api'

/** Kitchen context for AI calls + a friendly message for AI errors. */
export function useAiContext() {
  const { kitchen, catalog, journal, recipes } = useApp()
  const context = useCallback(() => kitchenContext(kitchen, catalog, journal, recipes), [kitchen, catalog, journal, recipes])
  const explain = useCallback((e: unknown) => {
    if (e instanceof ApiError) {
      if (e.status === 401) return 'Unlock the app (My → Instamart) to use AI.'
      if (e.reason === 'ai_off') return 'AI isn’t set up on the server yet.'
      return e.message
    }
    return 'The AI couldn’t answer. Try again.'
  }, [])
  return { context, explain }
}
