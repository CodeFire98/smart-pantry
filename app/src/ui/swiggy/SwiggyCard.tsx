import { useEffect, useState } from 'react'
import { api, type Address } from '../../swiggy/api'
import { useSwiggy } from '../../swiggy/useSwiggy'
import { useApp } from '../AppContext'

/** My tab → Instamart: app passcode, Swiggy login, delivery address. */
export function SwiggyCard() {
  const { status, refresh, explain } = useSwiggy()
  const { toast } = useApp()
  const [passcode, setPasscode] = useState('')
  const [busy, setBusy] = useState(false)
  const [addresses, setAddresses] = useState<Address[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)
  const sw = status?.swiggy
  const showPicker = !!sw?.connected && (!sw.address || picking)

  useEffect(() => {
    if (status?.authed && showPicker && addresses === null) {
      api.addresses().then(r => setAddresses(r.addresses)).catch(e => setErr(explain(e)))
    }
  }, [status, showPicker, addresses, explain])

  const run = async (fn: () => Promise<unknown>, done?: string) => {
    setBusy(true); setErr(null)
    try { await fn(); await refresh(); if (done) toast(done) } catch (e) { setErr(explain(e)) } finally { setBusy(false) }
  }

  if (!status) return <div className="card"><b>Instamart</b><div className="sub">Instamart needs a connection to the server. You seem to be offline.</div></div>

  if (!status.authed) return <form className="card" onSubmit={e => { e.preventDefault(); run(async () => { await api.login(passcode); setPasscode('') }, 'Logged in') }}>
    <div className="row" style={{ justifyContent: 'space-between' }}><b>Instamart</b><span className="sim">Locked</span></div>
    <div className="sub">Enter your app passcode to use Instamart. It keeps your Swiggy account safe on this public site.</div>
    <div className="askbox" style={{ marginTop: 0 }}>
      <input id="passcode" type="password" autoComplete="current-password" value={passcode} onChange={e => setPasscode(e.target.value)} placeholder="App passcode" aria-label="App passcode" />
      <button className="btn accent" disabled={busy || !passcode}>Unlock</button>
    </div>
    {err && <div className="sub missing">{err}</div>}
  </form>

  if (!sw?.connected) return <div className="card">
    <div className="row" style={{ justifyContent: 'space-between' }}><b>Instamart</b><span className="sim">Not connected</span></div>
    <div className="sub">Log in to Swiggy once with your phone number and OTP. The app can then search Instamart, fill your cart and add deliveries to your pantry. Nothing is ordered without your confirmation.</div>
    <a className="btn accent" href="/api/auth/swiggy/start">Connect Instamart</a>
    {location.hostname !== 'localhost' && <div className="sub">Until Swiggy approves this app, login only works when the app runs on localhost.</div>}
    {err && <div className="sub missing">{err}</div>}
    <button className="linkbtn" onClick={() => run(api.logout)}>Lock the app</button>
  </div>

  const days = sw.expiresAt ? Math.max(0, Math.round((sw.expiresAt - Date.now()) / 86_400_000)) : null
  return <div className="card">
    <div className="row" style={{ justifyContent: 'space-between' }}><b>Instamart</b><span className="tierpill" style={{ background: 'var(--have-soft)', color: 'var(--have)' }}>Connected</span></div>
    {!showPicker && sw.address
      ? <div className="sub">Delivering to <b>{sw.address.label}</b>. {days != null && `Swiggy login is valid for ${days} more day${days === 1 ? '' : 's'}.`}</div>
      : <>
          <div className="sub">Pick the address Instamart should deliver to.</div>
          {addresses === null ? <div className="sub"><span className="spin" /> Loading your addresses…</div>
            : addresses.length === 0 ? <div className="sub">No saved addresses. Add one in the Swiggy app, then reload.</div>
            : <div className="group">{addresses.map(a => <div className="prow" key={a.id}>
                <span className="pname">{a.label}<small>{a.line}</small></span>
                <button className="btn sm ghost" disabled={busy} onClick={() => run(async () => { await api.selectAddress(a); setPicking(false) }, `Delivering to ${a.label}`)}>Use</button>
              </div>)}</div>}
        </>}
    {!status.ordering && <div className="sub">Placing orders is switched off on this server, so you can fill the cart and finish the order in the Swiggy app.</div>}
    {err && <div className="sub missing">{err}</div>}
    <div className="row">
      {sw.address && !picking && <button className="linkbtn" onClick={() => setPicking(true)}>Change address</button>}
      <button className="linkbtn" onClick={() => run(api.disconnect, 'Disconnected from Instamart')}>Disconnect Swiggy</button>
      <button className="linkbtn" onClick={() => run(api.logout)}>Lock the app</button>
    </div>
  </div>
}
