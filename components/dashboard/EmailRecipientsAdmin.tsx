'use client'

import { useState, useEffect, useCallback } from 'react'

// Admin-only management of the weekly-email stakeholder list + a manual "Send now" trigger.
// Rendered inside the authed /admin shell. All API calls are cookie-authed (same-origin) and
// server-side gated by isAdminRequest.

interface Recipient {
  id: number
  email: string
  name: string | null
  active: boolean
}

const C = {
  surface: 'var(--ds-surface)', border: 'var(--ds-border)', bg: 'var(--ds-bg)',
  text: 'var(--ds-text)', muted: 'var(--ds-muted)', dim: 'var(--ds-dim)',
  green: 'var(--ds-green)', greenL: 'var(--ds-green-light)', red: '#f87171',
}

export function EmailRecipientsAdmin() {
  const [recipients, setRecipients] = useState<Recipient[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [adding, setAdding] = useState(false)

  const [sendState, setSendState] = useState<{ kind: 'idle' | 'sending' | 'ok' | 'err'; msg?: string }>({ kind: 'idle' })
  const [showPreview, setShowPreview] = useState(false)
  const [previewNonce, setPreviewNonce] = useState(0) // bump to force the iframe to re-fetch
  const [feedbackPrompt, setFeedbackPrompt] = useState<boolean | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setErr(null)
    try {
      const res = await fetch('/api/email/recipients')
      const j = await res.json()
      if (!res.ok) { setErr(j.error ?? 'Failed to load recipients'); return }
      setRecipients(j.recipients ?? [])
    } catch {
      setErr('Failed to load recipients (network)')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // Load the "show feedback callout" setting (best-effort; defaults to on).
  useEffect(() => {
    fetch('/api/email/settings')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (j) setFeedbackPrompt(!!j.feedbackPrompt) })
      .catch(() => {})
  }, [])

  async function toggleFeedback() {
    const next = !feedbackPrompt
    setFeedbackPrompt(next) // optimistic
    try {
      await fetch('/api/email/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feedbackPrompt: next }),
      })
      setPreviewNonce((n) => n + 1) // refresh the preview if it's open
    } catch {
      setFeedbackPrompt(!next) // revert on failure
    }
  }

  async function add() {
    if (!email.trim()) return
    setAdding(true); setErr(null)
    try {
      const res = await fetch('/api/email/recipients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, name }),
      })
      const j = await res.json()
      if (!res.ok) { setErr(j.error ?? 'Failed to add recipient'); return }
      setEmail(''); setName('')
      await load()
    } catch {
      setErr('Failed to add recipient (network)')
    } finally {
      setAdding(false)
    }
  }

  async function toggleActive(r: Recipient) {
    await fetch(`/api/email/recipients/${r.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: !r.active }),
    })
    await load()
  }

  async function remove(id: number) {
    if (!confirm('Remove this recipient?')) return
    await fetch(`/api/email/recipients/${id}`, { method: 'DELETE' })
    await load()
  }

  function togglePreview() {
    if (!showPreview) setPreviewNonce((n) => n + 1) // refresh on open
    setShowPreview((s) => !s)
  }

  async function sendNow() {
    if (!confirm('Send the weekly summary email to all active recipients now?')) return
    setSendState({ kind: 'sending' })
    try {
      const res = await fetch('/api/email/weekly', { method: 'POST' })
      const j = await res.json()
      if (!res.ok || !j.ok) {
        setSendState({ kind: 'err', msg: j.error ?? 'Send failed' })
        return
      }
      setSendState({ kind: 'ok', msg: `Sent to ${j.sent} recipient${j.sent === 1 ? '' : 's'}.` })
    } catch {
      setSendState({ kind: 'err', msg: 'Send failed (network)' })
    }
  }

  const label = 'font-mono text-[11px] uppercase tracking-wider block mb-1'
  const input = 'font-mono text-sm px-2.5 py-1.5 rounded-md outline-none'
  const inputStyle = { background: C.bg, border: `1px solid ${C.border}`, color: C.text } as const

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-medium leading-tight" style={{ color: C.text }}>Weekly email recipients</h1>
          <p className="mt-1 font-mono text-sm" style={{ color: C.muted }}>
            Stakeholders who receive the Friday summary. Inactive recipients are skipped.
          </p>
          <label className="mt-3 flex items-center gap-2 font-mono text-xs" style={{ color: C.muted, cursor: feedbackPrompt === null ? 'default' : 'pointer' }}>
            <input type="checkbox" checked={!!feedbackPrompt} disabled={feedbackPrompt === null} onChange={toggleFeedback} />
            Show the &ldquo;we&rsquo;d love your feedback&rdquo; callout at the top of the email
          </label>
        </div>
        <div className="flex flex-col items-end gap-1">
          <div className="flex gap-2">
            <button
              onClick={togglePreview}
              className="font-mono text-xs px-3 py-1.5 rounded-lg"
              style={{ background: showPreview ? C.bg : C.surface, color: C.muted, border: `1px solid ${C.border}`, cursor: 'pointer' }}
            >
              {showPreview ? 'Hide preview' : 'Preview email'}
            </button>
            <button
              onClick={sendNow}
              disabled={sendState.kind === 'sending'}
              className="font-mono text-xs px-3 py-1.5 rounded-lg"
              style={{ background: C.green, color: '#fff', border: `1px solid ${C.green}`, cursor: sendState.kind === 'sending' ? 'wait' : 'pointer' }}
            >
              {sendState.kind === 'sending' ? 'Sending…' : 'Send weekly email now'}
            </button>
          </div>
          {sendState.kind === 'ok' && <span className="font-mono text-[11px]" style={{ color: C.greenL }}>{sendState.msg}</span>}
          {sendState.kind === 'err' && <span className="font-mono text-[11px]" style={{ color: C.red }}>{sendState.msg}</span>}
        </div>
      </div>

      {/* Live preview — renders the exact HTML the weekly send produces (no email sent) */}
      {showPreview && (
        <div className="rounded-lg overflow-hidden" style={{ border: `1px solid ${C.border}` }}>
          <div className="px-3 py-2 flex items-center justify-between" style={{ borderBottom: `1px solid ${C.border}`, background: C.surface }}>
            <span className="font-mono text-[11px] uppercase tracking-wider" style={{ color: C.muted }}>Email preview — exactly what will send</span>
            <button onClick={() => setPreviewNonce((n) => n + 1)} className="font-mono text-[11px]" style={{ color: C.muted, cursor: 'pointer' }}>refresh</button>
          </div>
          <iframe
            key={previewNonce}
            src={`/api/email/weekly?preview=1&t=${previewNonce}`}
            title="Weekly email preview"
            style={{ width: '100%', height: 640, border: 'none', background: '#0d1117' }}
          />
        </div>
      )}

      {/* Add form */}
      <div className="rounded-lg p-4 flex items-end gap-3 flex-wrap" style={{ background: C.surface, border: `1px solid ${C.border}` }}>
        <div>
          <span className={label} style={{ color: C.muted }}>Email</span>
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@coverdash.com"
            className={input} style={{ ...inputStyle, width: 240 }} onKeyDown={(e) => { if (e.key === 'Enter') add() }} />
        </div>
        <div>
          <span className={label} style={{ color: C.muted }}>Name (optional)</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Doe"
            className={input} style={{ ...inputStyle, width: 180 }} onKeyDown={(e) => { if (e.key === 'Enter') add() }} />
        </div>
        <button onClick={add} disabled={adding || !email.trim()}
          className="font-mono text-xs px-3 py-1.5 rounded-lg"
          style={{ background: C.green, color: '#fff', border: `1px solid ${C.green}`, opacity: !email.trim() ? 0.5 : 1, cursor: adding ? 'wait' : !email.trim() ? 'not-allowed' : 'pointer' }}>
          + Add
        </button>
      </div>

      {err && <p className="font-mono text-xs" style={{ color: C.red }}>{err}</p>}

      {/* List */}
      <div className="rounded-lg overflow-hidden" style={{ background: C.surface, border: `1px solid ${C.border}` }}>
        <table className="w-full text-left font-mono text-xs">
          <thead>
            <tr style={{ borderBottom: `1px solid ${C.border}` }}>
              <th className="px-4 py-3 font-normal" style={{ color: C.dim }}>Email</th>
              <th className="px-4 py-3 font-normal" style={{ color: C.dim }}>Name</th>
              <th className="px-4 py-3 font-normal" style={{ color: C.dim }}>Status</th>
              <th className="px-4 py-3 font-normal text-right" style={{ color: C.dim }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={4} className="px-4 py-4" style={{ color: C.muted }}>Loading…</td></tr>
            ) : recipients.length === 0 ? (
              <tr><td colSpan={4} className="px-4 py-4" style={{ color: C.muted }}>No recipients yet.</td></tr>
            ) : recipients.map((r) => (
              <tr key={r.id} style={{ borderBottom: `1px solid ${C.border}` }}>
                <td className="px-4 py-2.5" style={{ color: C.text }}>{r.email}</td>
                <td className="px-4 py-2.5" style={{ color: C.muted }}>{r.name || '—'}</td>
                <td className="px-4 py-2.5">
                  <span style={{ color: r.active ? C.greenL : C.dim }}>{r.active ? 'active' : 'paused'}</span>
                </td>
                <td className="px-4 py-2.5 text-right whitespace-nowrap">
                  <button onClick={() => toggleActive(r)} className="px-1.5" style={{ color: C.muted, cursor: 'pointer' }}>
                    {r.active ? 'pause' : 'resume'}
                  </button>
                  <button onClick={() => remove(r.id)} className="px-1.5" style={{ color: C.red, cursor: 'pointer' }}>del</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
