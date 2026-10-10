import { Redis } from '@upstash/redis'
import { HttpError } from './http.js'

let client: Redis | null = null

/** Upstash client. The Vercel Marketplace integration provides either the UPSTASH_* or the KV_* variable names. */
export function redis(): Redis {
  if (client) return client
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN
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
