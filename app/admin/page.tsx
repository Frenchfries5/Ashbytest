'use client'

import { useState, useEffect, FormEvent } from 'react'
import { InboundDashboard } from '@/components/dashboard/InboundDashboard'
import { EmailRecipientsAdmin } from '@/components/dashboard/EmailRecipientsAdmin'

// Password-gated admin view. The public dashboard is read-only; managing inbound postings
// (add / edit / delete) happens here. The gate is enforced server-side on the write routes —
// this page just drives the session cookie and shows the editing UI once signed in.

export default function AdminPage() {
  const [authed, setAuthed] = useState<boolean | null>(null)
  const [configured, setConfigured] = useState(true)
  const [password, setPassword] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    fetch('/api/admin')
      .then(r => r.json())
      .then(j => { setAuthed(!!j.authed); setConfigured(!!j.configured) })
      .catch(() => setAuthed(false))
  }, [])

  async function login(e: FormEvent) {
    e.preventDefault()
    setSubmitting(true); setErr(null)
    try {
      const res = await fetch('/api/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      const j = await res.json()
      if (!res.ok) { setErr(j.error ?? 'Login failed.'); return }
      setPassword('')
      setAuthed(true)
    } catch {
      setErr('Login failed (network).')
    } finally {
      setSubmitting(false)
    }
  }

  async function logout() {
    await fetch('/api/admin', { method: 'DELETE' })
    setAuthed(false)
  }

  const shell = { backgroundColor: 'var(--ds-bg)', minHeight: '100vh' } as const

  if (authed === null) {
    return (
      <div style={shell} className="flex items-center justify-center">
        <p className="font-mono text-sm" style={{ color: 'var(--ds-muted)' }}>Loading…</p>
      </div>
    )
  }

  if (!authed) {
    return (
      <div style={shell} className="flex items-center justify-center p-4">
        <form
          onSubmit={login}
          className="w-full max-w-sm rounded-lg p-6 flex flex-col gap-4"
          style={{ background: 'var(--ds-surface)', border: '1px solid var(--ds-border)' }}
        >
          <div>
            <h1 className="text-lg font-medium" style={{ color: 'var(--ds-text)' }}>Admin access</h1>
            <p className="mt-1 font-mono text-xs" style={{ color: 'var(--ds-muted)' }}>
              Sign in to manage inbound postings.
            </p>
          </div>
          <div>
            <span className="font-mono text-[11px] uppercase tracking-wider block mb-1" style={{ color: 'var(--ds-muted)' }}>Password</span>
            <input
              type="password"
              value={password}
              autoFocus
              onChange={e => setPassword(e.target.value)}
              className="w-full font-mono text-sm px-2.5 py-1.5 rounded-md outline-none"
              style={{ background: 'var(--ds-bg)', border: '1px solid var(--ds-border)', color: 'var(--ds-text)' }}
            />
          </div>
          {!configured && (
            <p className="font-mono text-xs" style={{ color: '#f8b34a' }}>
              ADMIN_PASSWORD is not set on the server — logins will fail until it is configured.
            </p>
          )}
          {err && <p className="font-mono text-xs" style={{ color: '#f87171' }}>{err}</p>}
          <button
            type="submit"
            disabled={submitting || !password}
            className="font-mono text-xs px-3 py-2 rounded-lg"
            style={{ background: 'var(--ds-green)', color: '#fff', border: '1px solid var(--ds-green)', opacity: submitting || !password ? 0.5 : 1, cursor: submitting ? 'wait' : !password ? 'not-allowed' : 'pointer' }}
          >
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
          <a href="/" className="font-mono text-[11px] text-center" style={{ color: 'var(--ds-muted)' }}>← Back to dashboard</a>
        </form>
      </div>
    )
  }

  return (
    <div style={shell}>
      <div
        className="sticky top-0 z-10 flex items-center justify-between px-6 py-3"
        style={{ backgroundColor: 'var(--ds-bg)', borderBottom: '1px solid var(--ds-border)' }}
      >
        <div className="flex items-center gap-3">
          <span className="font-mono text-xs px-2 py-0.5 rounded" style={{ background: 'rgba(58,222,160,0.15)', color: 'var(--ds-green-light)' }}>ADMIN</span>
          <a href="/" className="font-mono text-xs" style={{ color: 'var(--ds-muted)' }}>← Back to dashboard</a>
        </div>
        <button
          onClick={logout}
          className="font-mono text-xs px-3 py-1.5 rounded-lg"
          style={{ background: 'var(--ds-surface)', border: '1px solid var(--ds-border)', color: 'var(--ds-muted)', cursor: 'pointer' }}
        >
          Sign out
        </button>
      </div>
      <main className="max-w-6xl mx-auto px-4 py-10 flex flex-col gap-12">
        <EmailRecipientsAdmin />
        <div style={{ borderTop: '1px solid var(--ds-border)' }} />
        <InboundDashboard admin />
      </main>
    </div>
  )
}
