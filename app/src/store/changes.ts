/** Tiny pub/sub so the store can tell the sync engine "something changed" without importing it. */
const listeners = new Set<() => void>()
export const onChange = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn) } }
export const notifyChange = () => listeners.forEach(fn => fn())
