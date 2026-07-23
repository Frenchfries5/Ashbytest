// Microsoft Graph email sender (server-only). Sends the weekly summary through M365 via the
// app-only client-credentials flow — no third-party vendor, and mail comes from a real
// Coverdash mailbox (MS_SENDER).
//
// Setup (Entra ID / tenant admin): register an app, grant it the Mail.Send APPLICATION
// permission with admin consent, and ideally scope it to just the sender mailbox with an
// Application Access Policy. Then set MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET, MS_SENDER.

export function graphMailConfigured(): boolean {
  return !!(process.env.MS_TENANT_ID && process.env.MS_CLIENT_ID && process.env.MS_CLIENT_SECRET && process.env.MS_SENDER)
}

async function getAppToken(): Promise<string> {
  const tenant = process.env.MS_TENANT_ID!
  const res = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.MS_CLIENT_ID!,
      client_secret: process.env.MS_CLIENT_SECRET!,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    }),
    cache: 'no-store',
  })
  const json = (await res.json().catch(() => ({}))) as { access_token?: string; error_description?: string; error?: string }
  if (!res.ok || !json.access_token) {
    throw new Error(`Graph token request failed: ${json.error_description || json.error || res.status}`)
  }
  return json.access_token
}

// Send one HTML email, BCC'ing the recipient list. `to` defaults to the sender mailbox so the
// broadcast stays BCC-only (recipients can't see each other), matching the prior behavior.
export async function sendGraphMail(opts: { subject: string; html: string; bcc: string[] }): Promise<void> {
  const sender = process.env.MS_SENDER!
  const token = await getAppToken()

  const message = {
    subject: opts.subject,
    body: { contentType: 'HTML', content: opts.html },
    toRecipients: [{ emailAddress: { address: sender } }],
    bccRecipients: opts.bcc.map((address) => ({ emailAddress: { address } })),
  }

  const res = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sender)}/sendMail`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, saveToSentItems: true }),
    cache: 'no-store',
  })
  // Graph sendMail returns 202 Accepted with an empty body on success.
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Graph sendMail failed (HTTP ${res.status}): ${text.slice(0, 300)}`)
  }
}
