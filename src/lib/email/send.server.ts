import { getRuntimeEnv } from '#/lib/db/connection'

export type OutgoingEmail = {
  to: string
  subject: string
  html: string
  text: string
}

/**
 * Send a transactional email. Provider selection, in order:
 * 1. Resend — when `RESEND_API_KEY` is set.
 * 2. Cloudflare Email (the `SEND_EMAIL` send_email binding) — when bound.
 * 3. Console — local development: logs the email (including any links) so
 *    flows are testable without a provider.
 *
 * The sender is `FROM_EMAIL_ADDRESS`, or `noreply@<APP_DOMAIN>` when unset.
 * Failures are thrown so auth flows can surface "could not send" to the user.
 */
export async function sendEmail(email: OutgoingEmail): Promise<void> {
  const env = getRuntimeEnv()
  const from = fromAddress(env.FROM_EMAIL_ADDRESS, env.APP_DOMAIN)

  if (env.RESEND_API_KEY) {
    await sendWithResend(env.RESEND_API_KEY, from, email)
    return
  }

  if (env.SEND_EMAIL) {
    await sendWithCloudflare(env.SEND_EMAIL, from, email)
    return
  }

  // Local development fallback: make the email inspectable in the terminal.
  console.log(
    `[email] no provider configured — would send from ${from}\n` +
      `[email] to: ${email.to}\n[email] subject: ${email.subject}\n` +
      `[email] ${email.text}`,
  )
}

function fromAddress(configured: string | undefined, appDomain?: string) {
  if (configured?.trim()) {
    return configured.trim()
  }

  // APP_DOMAIN may carry a port in local dev; an email domain never does.
  const domain = (appDomain ?? 'localhost').split(':')[0]

  return `noreply@${domain}`
}

async function sendWithResend(
  apiKey: string,
  from: string,
  email: OutgoingEmail,
) {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      from: `Potion <${from}>`,
      to: [email.to],
      subject: email.subject,
      html: email.html,
      text: email.text,
    }),
  })

  if (!response.ok) {
    throw new Error(`Resend rejected the email (${response.status}).`)
  }
}

async function sendWithCloudflare(
  binding: SendEmail,
  from: string,
  email: OutgoingEmail,
) {
  // Imported lazily: the module only exists inside the Workers runtime.
  const { EmailMessage } = await import('cloudflare:email')
  const boundary = `potion-${crypto.randomUUID()}`
  const raw = [
    `From: Potion <${from}>`,
    `To: <${email.to}>`,
    `Subject: ${email.subject}`,
    `Message-ID: <${crypto.randomUUID()}@${from.split('@')[1]}>`,
    `Date: ${new Date().toUTCString()}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=utf-8',
    '',
    email.text,
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset=utf-8',
    '',
    email.html,
    '',
    `--${boundary}--`,
    '',
  ].join('\r\n')

  await binding.send(new EmailMessage(from, email.to, raw))
}

/** Shared minimal template for auth emails: a heading, a line, and a button. */
export function authEmail({
  heading,
  body,
  actionLabel,
  actionUrl,
}: {
  heading: string
  body: string
  actionLabel: string
  actionUrl: string
}): Pick<OutgoingEmail, 'html' | 'text'> {
  return {
    text: `${heading}\n\n${body}\n\n${actionLabel}: ${actionUrl}\n\nIf you didn't request this, you can ignore this email.`,
    html: `<!doctype html>
<body style="margin:0;padding:32px 16px;background:#f5f2ea;font-family:ui-sans-serif,-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;color:#24231f">
  <div style="max-width:440px;margin:0 auto;background:#fbfaf5;border:1px solid rgba(42,38,31,.14);border-radius:12px;padding:28px">
    <div style="width:36px;height:36px;border-radius:8px;background:#6d4b7c;color:#fff;font-weight:700;font-size:18px;line-height:36px;text-align:center">P</div>
    <h1 style="font-size:20px;margin:16px 0 8px">${heading}</h1>
    <p style="font-size:14px;line-height:1.6;color:#625d51;margin:0 0 20px">${body}</p>
    <a href="${actionUrl}" style="display:inline-block;background:#6d4b7c;color:#fff;text-decoration:none;font-size:14px;font-weight:600;padding:10px 18px;border-radius:8px">${actionLabel}</a>
    <p style="font-size:12px;color:#625d51;margin:20px 0 0">If you didn't request this, you can ignore this email.</p>
  </div>
</body>`,
  }
}
