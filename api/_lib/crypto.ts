import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { HttpError } from './http.js'

function secret(name: 'TOKEN_ENC_KEY' | 'SESSION_SECRET'): Buffer {
  const v = process.env[name]
  if (!v) throw new HttpError(503, `Server secret ${name} isn’t set.`)
  const buf = Buffer.from(v, 'base64')
  if (buf.length < 32) throw new HttpError(503, `Server secret ${name} must be at least 32 bytes (base64).`)
  return buf.subarray(0, 32)
}

/** AES-256-GCM. Output: base64(iv[12] | tag[16] | ciphertext). */
export function encrypt(plain: string, key = secret('TOKEN_ENC_KEY')): string {
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', key, iv)
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()])
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64')
}

export function decrypt(blob: string, key = secret('TOKEN_ENC_KEY')): string {
  const buf = Buffer.from(blob, 'base64')
  const d = createDecipheriv('aes-256-gcm', key, buf.subarray(0, 12))
  d.setAuthTag(buf.subarray(12, 28))
  return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8')
}

export function hmac(data: string, key = secret('SESSION_SECRET')): string {
  return createHmac('sha256', key).update(data).digest('base64url')
}

/** Constant-time string comparison (hashes first so lengths don't leak). */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest(), hb = createHash('sha256').update(b).digest()
  return timingSafeEqual(ha, hb)
}

export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url')

export function pkcePair() {
  const verifier = randomToken(32)
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  return { verifier, challenge }
}
