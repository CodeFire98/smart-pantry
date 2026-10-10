// Read-only debugging: call one Instamart tool with the stored Swiggy login and print the response SHAPE.
// Strings are redacted to their length, so addresses, names and phone numbers never get printed.
// Usage: node --env-file=.env.local scripts/swiggy-shape.mjs get_addresses '{"pageSize":10}'
import { createDecipheriv } from 'node:crypto'
import { Redis } from '@upstash/redis'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

const READ_ONLY = new Set(['get_addresses', 'search_products', 'get_cart', 'get_orders', 'get_order_details', 'your_go_to_items', 'get_payment_options', 'get_delivery_status'])
const [tool, rawArgs = '{}', mode] = process.argv.slice(2)
if (!READ_ONLY.has(tool)) { console.error(`Only read-only tools: ${[...READ_ONLY].join(', ')}`); process.exit(1) }

const env = k => Object.entries(process.env).find(([n, v]) => v && (n === k || n.endsWith(`_${k}`)))?.[1]
const redis = new Redis({ url: env('KV_REST_API_URL'), token: env('KV_REST_API_TOKEN') })
const row = await redis.get('sp:swiggy:token')
if (!row) { console.error('No Swiggy login stored. Connect Instamart in the app first.'); process.exit(1) }
const key = Buffer.from(process.env.TOKEN_ENC_KEY, 'base64').subarray(0, 32)
const buf = Buffer.from(row.enc, 'base64')
const d = createDecipheriv('aes-256-gcm', key, buf.subarray(0, 12)); d.setAuthTag(buf.subarray(12, 28))
const token = Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8')

const client = new Client({ name: 'smart-pantry-debug', version: '0.0.1' })
await client.connect(new StreamableHTTPClientTransport(new URL('https://mcp.swiggy.com/im'), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }))
let args = JSON.parse(rawArgs)
if (rawArgs.includes('$DEFAULT_ADDRESS')) {
  // Resolve Swiggy's default address id without printing it.
  const a = await client.callTool({ name: 'get_addresses', arguments: { pageSize: 10 } })
  args = JSON.parse(rawArgs.replace('$DEFAULT_ADDRESS', a.structuredContent?.resolution?.defaultAddressId ?? ''))
}
const res = await client.callTool({ name: tool, arguments: args })
if (mode === '--error-text' && res.isError) console.error('error message:', res.structuredContent?.error?.message ?? res.content?.[0]?.text)
await client.close()

const SAFE = /^(success|isError|type|status|orderType|kind|hasMore|inStock|isAvail|isActive|isInStockAndAvailable|quantityDescription|addressCategory|addressTag|annotation|category)$/
const redact = (v, k = '') => Array.isArray(v) ? (v.length ? [redact(v[0], k), `…${v.length} items`] : [])
  : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([kk, vv]) => [kk, redact(vv, kk)]))
  : typeof v === 'string' ? (SAFE.test(k) && v.length < 40 ? v : `<string ${v.length}>`) : v

const parsed = { ...res }
for (const c of parsed.content ?? []) if (c.type === 'text') { try { c.text = JSON.parse(c.text) } catch { /* plain text */ } }
console.log(JSON.stringify(redact(parsed), null, 2))
