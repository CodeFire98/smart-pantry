import { Redis } from '@upstash/redis'
import { HttpError } from './http.js'

let client: Redis | null = null

/** Upstash client. The Vercel Marketplace integration provides either the UPSTASH_* or the KV_* variable names. */
export function redis(): Redis {
  if (client) return client
  // The integration may add a custom prefix (e.g. spantry_KV_REST_API_URL), so match by suffix.
  const find = (suffix: string) => Object.entries(process.env).find(([k, v]) => v && (k === suffix || k.endsWith(`_${suffix}`)))?.[1]
  const url = find('UPSTASH_REDIS_REST_URL') ?? find('KV_REST_API_URL')
  const token = find('UPSTASH_REDIS_REST_TOKEN') ?? find('KV_REST_API_TOKEN')
  if (!url || !token) throw new HttpError(503, 'Server storage isn’t set up yet (Upstash Redis).')
  client = new Redis({ url, token })
  return client
}

export const KEYS = {
  token: 'sp:swiggy:token',
  address: 'sp:swiggy:address',
  client: (redirectUri: string) => `sp:swiggy:client:${redirectUri}`,
  pkce: (state: string) => `sp:swiggy:pkce:${state}`,
  nonce: (n: string) => `sp:swiggy:nonce:${n}`,
  loginAttempts: (ip: string) => `sp:rl:login:${ip}`
}
