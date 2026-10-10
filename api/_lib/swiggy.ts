import type { VercelRequest } from '@vercel/node'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport, StreamableHTTPError } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { McpError } from '@modelcontextprotocol/sdk/types.js'
import { decrypt, encrypt, pkcePair, randomToken } from './crypto.js'
import { HttpError } from './http.js'
import { KEYS, redis } from './redis.js'

const BASE = 'https://mcp.swiggy.com'
const IM = `${BASE}/im`

interface AuthServer { authorization_endpoint: string; token_endpoint: string; registration_endpoint: string }
let meta: AuthServer | null = null

async function authServer(): Promise<AuthServer> {
  if (meta) return meta
  try {
    const r = await fetch(`${BASE}/.well-known/oauth-authorization-server`)
    if (r.ok) {
      const m = await r.json() as Partial<AuthServer>
      if (m.authorization_endpoint && m.token_endpoint) {
        meta = { registration_endpoint: `${BASE}/auth/register`, ...m } as AuthServer
        return meta
      }
    }
  } catch { /* fall through to documented defaults */ }
  meta = { authorization_endpoint: `${BASE}/auth/authorize`, token_endpoint: `${BASE}/auth/token`, registration_endpoint: `${BASE}/auth/register` }
  return meta
}

/** Callback URL for the host the request came in on (localhost in development, the Vercel domain in production). */
export function redirectUri(req: VercelRequest): string {
  const host = String(req.headers['x-forwarded-host'] ?? req.headers.host ?? '')
  const local = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)
  const proto = local ? 'http' : 'https'
  return `${proto}://${host}/api/auth/swiggy/callback`
}

/** Dynamic Client Registration (RFC 7591), cached per redirect URI. */
async function clientId(uri: string): Promise<string> {
  const cached = await redis().get<string>(KEYS.client(uri))
  if (cached) return cached
  const { registration_endpoint } = await authServer()
  const r = await fetch(registration_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: 'Smart Pantry', redirect_uris: [uri], grant_types: ['authorization_code'],
      response_types: ['code'], token_endpoint_auth_method: 'none', scope: 'mcp:tools'
    })
  })
  if (!r.ok) throw new HttpError(502, `Swiggy didn’t accept the app registration (${r.status}).`)
  const { client_id } = await r.json() as { client_id?: string }
  if (!client_id) throw new HttpError(502, 'Swiggy registration returned no client id.')
  await redis().set(KEYS.client(uri), client_id)
  return client_id
}

/** Build the Swiggy login URL; PKCE verifier and state live in Redis for 5 minutes. */
export async function startAuth(req: VercelRequest): Promise<string> {
  const uri = redirectUri(req)
  const id = await clientId(uri)
  const { verifier, challenge } = pkcePair()
  const state = randomToken(24)
  await redis().set(KEYS.pkce(state), { verifier, uri, id }, { ex: 300 })
  const { authorization_endpoint } = await authServer()
  const q = new URLSearchParams({
    response_type: 'code', client_id: id, redirect_uri: uri, code_challenge: challenge,
    code_challenge_method: 'S256', state, scope: 'mcp:tools'
  })
  return `${authorization_endpoint}?${q}`
}

export async function finishAuth(code: string, state: string): Promise<void> {
  const saved = await redis().getdel<{ verifier: string; uri: string; id: string }>(KEYS.pkce(state))
  if (!saved) throw new HttpError(400, 'This Swiggy login link expired. Start again from the app.')
  const { token_endpoint } = await authServer()
  const r = await fetch(token_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grant_type: 'authorization_code', code, code_verifier: saved.verifier, redirect_uri: saved.uri, client_id: saved.id })
  })
  if (!r.ok) throw new HttpError(502, `Swiggy login didn’t complete (${r.status}). Try again.`)
  const t = await r.json() as { access_token?: string; expires_in?: number }
  if (!t.access_token) throw new HttpError(502, 'Swiggy returned no access token.')
  const ttl = Math.max(60, Math.min(t.expires_in ?? 432000, 432000))
  await redis().set(KEYS.token, { enc: encrypt(t.access_token), expiresAt: Date.now() + ttl * 1000 }, { ex: ttl })
}

export async function tokenInfo(): Promise<{ token: string; expiresAt: number } | null> {
  const row = await redis().get<{ enc: string; expiresAt: number }>(KEYS.token)
  if (!row) return null
  try { return { token: decrypt(row.enc), expiresAt: row.expiresAt } } catch { return null }
}

export async function disconnect() {
  const t = await tokenInfo()
  await redis().del(KEYS.token, KEYS.address)
  if (t) await fetch(`${BASE}/auth/logout`, { method: 'POST', headers: { Authorization: `Bearer ${t.token}` } }).catch(() => {})
}

/** A Swiggy tool failure, bucketed per https://mcp.swiggy.com/builders/docs/reference/errors.md */
export class SwiggyError extends HttpError {
  constructor(status: number, message: string, public kind: 'auth' | 'input' | 'domain' | 'upstream' | 'rate') {
    super(status, message, { reason: kind === 'auth' ? 'swiggy_reconnect' : kind })
  }
}

function classify(e: unknown): SwiggyError {
  if (e instanceof SwiggyError) return e
  const status = e instanceof StreamableHTTPError ? Number(e.code) : undefined
  const rpc = e instanceof McpError ? e.code : undefined
  const msg = e instanceof Error ? e.message : String(e)
  if (status === 401 || status === 419 || rpc === -32001) return new SwiggyError(401, 'Your Swiggy login expired. Reconnect Instamart.', 'auth')
  if (status === 429) return new SwiggyError(429, 'Swiggy is rate-limiting requests. Wait a minute and try again.', 'rate')
  if (status === 400) return new SwiggyError(400, msg, 'input')
  return new SwiggyError(502, 'Swiggy didn’t respond properly. Try again in a moment.', 'upstream')
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

export type Call = <T = unknown>(tool: string, args?: Record<string, unknown>, opts?: { retry?: boolean }) => Promise<T>

/**
 * Open one MCP session to Instamart, run `fn`, close. `call` unwraps Swiggy's {success, data, error} envelope.
 * Reads and cart writes may retry transient failures (they're idempotent); pass retry:false for checkout.
 */
export async function withSwiggy<R>(fn: (call: Call) => Promise<R>): Promise<R> {
  const t = await tokenInfo()
  if (!t) throw new SwiggyError(401, 'Connect Instamart first.', 'auth')
  const client = new Client({ name: 'smart-pantry', version: '0.2.0' })
  const transport = new StreamableHTTPClientTransport(new URL(IM), { requestInit: { headers: { Authorization: `Bearer ${t.token}` } } })
  try {
    await client.connect(transport)
  } catch (e) { throw classify(e) }

  const call: Call = async <T,>(tool: string, args: Record<string, unknown> = {}, opts: { retry?: boolean } = {}) => {
    const attempts = opts.retry === false ? 1 : 3
    for (let i = 0; ; i++) {
      try {
        const res = await client.callTool({ name: tool, arguments: args })
        return unwrap<T>(res, tool)
      } catch (e) {
        const err = classify(e)
        if (err.kind !== 'upstream' || i + 1 >= attempts) throw err
        await sleep(500 * 2 ** i + Math.random() * 200)
      }
    }
  }
  try { return await fn(call) } finally { await client.close().catch(() => {}) }
}

interface Envelope { success?: boolean; data?: unknown; message?: string; error?: { message?: string } }

export function unwrap<T>(res: unknown, tool: string): T {
  const r = res as { structuredContent?: Envelope; content?: Array<{ type: string; text?: string }>; isError?: boolean }
  let env: Envelope | undefined = r.structuredContent && 'success' in r.structuredContent ? r.structuredContent : undefined
  if (!env) {
    const text = r.content?.find(c => c.type === 'text')?.text ?? ''
    try { env = JSON.parse(text) as Envelope } catch { env = r.isError ? { success: false, error: { message: text } } : { success: true, data: text } }
  }
  if (env.success === false || r.isError) {
    const m = env.error?.message ?? env.message ?? `${tool} failed`
    if (/^(Invalid|Missing)\b/i.test(m)) throw new SwiggyError(400, m, 'input')
    throw new SwiggyError(409, m, 'domain')
  }
  return (env.data ?? env) as T
}
