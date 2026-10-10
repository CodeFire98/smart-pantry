import type { VercelRequest, VercelResponse } from '@vercel/node'
import { hmac, safeEqual } from './crypto.js'
import { HttpError, clientIp } from './http.js'
import { KEYS, redis } from './redis.js'

const COOKIE = 'sp_session'
const MAX_AGE = 30 * 24 * 3600
const MAX_ATTEMPTS = 5
const WINDOW = 15 * 60

export function signSession(expiresAt: number, key?: Buffer): string {
  const payload = Buffer.from(JSON.stringify({ v: 1, exp: expiresAt })).toString('base64url')
  return `${payload}.${hmac(payload, key)}`
}

/** True when the cookie value carries a valid signature and hasn't expired. */
export function verifySession(value: string | undefined, now = Date.now(), key?: Buffer): boolean {
  if (!value) return false
  const [payload, sig] = value.split('.')
  if (!payload || !sig || !safeEqual(sig, hmac(payload, key))) return false
  try {
    const { exp } = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { exp: number }
    return typeof exp === 'number' && exp > now
  } catch { return false }
}

function readCookie(req: VercelRequest, name: string): string | undefined {
  const raw = req.headers.cookie ?? ''
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k === name) return decodeURIComponent(v.join('='))
  }
  return undefined
}

const isLocal = (req: VercelRequest) => /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(String(req.headers.host ?? ''))

export const isAuthed = (req: VercelRequest) => verifySession(readCookie(req, COOKIE))

export function requireSession(req: VercelRequest) {
  if (!isAuthed(req)) throw new HttpError(401, 'Log in with your app passcode first.', { reason: 'app_login' })
}

/** Check the passcode with a per-IP limit of 5 attempts per 15 minutes; on success set the session cookie. */
export async function login(req: VercelRequest, res: VercelResponse, passcode: string) {
  const expected = process.env.APP_PASSCODE
  if (!expected) throw new HttpError(503, 'APP_PASSCODE isn’t set on the server.')
  const key = KEYS.loginAttempts(clientIp(req))
  const attempts = await redis().incr(key)
  if (attempts === 1) await redis().expire(key, WINDOW)
  if (attempts > MAX_ATTEMPTS) throw new HttpError(429, 'Too many tries. Wait 15 minutes and try again.')
  if (!safeEqual(passcode, expected)) throw new HttpError(401, 'That passcode isn’t right.')
  await redis().del(key)
  const value = signSession(Date.now() + MAX_AGE * 1000)
  res.setHeader('Set-Cookie', `${COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE}${isLocal(req) ? '' : '; Secure'}`)
}

export function logout(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${isLocal(req) ? '' : '; Secure'}`)
}
