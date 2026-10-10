import type { VercelRequest, VercelResponse } from '@vercel/node'

/** An error with an HTTP status and a message safe to show the user. */
export class HttpError extends Error {
  constructor(public status: number, message: string, public body: Record<string, unknown> = {}) {
    super(message)
  }
}

type Handler = (req: VercelRequest, res: VercelResponse) => Promise<unknown>

/** Wrap a handler: JSON in/out, no caching, HttpError → status + {error}, anything else → 500 without details. */
export function route(methods: string[], fn: Handler) {
  return async (req: VercelRequest, res: VercelResponse) => {
    res.setHeader('Cache-Control', 'no-store')
    if (!methods.includes(req.method ?? 'GET')) {
      res.setHeader('Allow', methods.join(', '))
      return res.status(405).json({ error: 'Method not allowed' })
    }
    try {
      const out = await fn(req, res)
      if (!res.headersSent) res.status(200).json(out ?? { ok: true })
    } catch (e) {
      if (e instanceof HttpError) return res.status(e.status).json({ error: e.message, ...e.body })
      console.error('[api] unexpected error', e instanceof Error ? e.message : e)
      res.status(500).json({ error: 'Something went wrong on the server. Try again.' })
    }
  }
}

export function body<T = Record<string, unknown>>(req: VercelRequest): T {
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body) as T } catch { throw new HttpError(400, 'Invalid JSON body') }
  }
  return (req.body ?? {}) as T
}

export function str(v: unknown, field: string, max = 200): string {
  if (typeof v !== 'string' || !v.trim() || v.length > max) throw new HttpError(400, `Missing or invalid ${field}`)
  return v.trim()
}

export const clientIp = (req: VercelRequest) =>
  String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() || req.socket?.remoteAddress || 'unknown'
