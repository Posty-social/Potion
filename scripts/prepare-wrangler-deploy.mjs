// Rewrites wrangler.jsonc for a production deploy (CI only):
//  - binds the Worker to APP_DOMAIN as a custom domain (auto DNS + cert)
//  - disables workers.dev + preview URLs so Cloudflare Access on APP_DOMAIN
//    cannot be bypassed via the raw workers.dev hostname
//  - sets production vars (BETTER_AUTH_URL / APP_DOMAIN) so they don't need
//    to be synced as secrets
//
// Run with --write to overwrite wrangler.jsonc in place; otherwise the result
// is printed to stdout (dry run).

import { readFileSync, writeFileSync } from 'node:fs'

/** Strip // and /* *\/ comments and trailing commas without touching strings. */
function jsoncToJson(source) {
  let out = ''
  let inString = false
  let inLineComment = false
  let inBlockComment = false

  for (let i = 0; i < source.length; i++) {
    const ch = source[i]
    const next = source[i + 1]

    if (inLineComment) {
      if (ch === '\n') {
        inLineComment = false
        out += ch
      }
      continue
    }

    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false
        i++
      }
      continue
    }

    if (inString) {
      out += ch
      if (ch === '\\') {
        out += next ?? ''
        i++
      } else if (ch === '"') {
        inString = false
      }
      continue
    }

    if (ch === '"') {
      inString = true
      out += ch
      continue
    }

    if (ch === '/' && next === '/') {
      inLineComment = true
      i++
      continue
    }

    if (ch === '/' && next === '*') {
      inBlockComment = true
      i++
      continue
    }

    out += ch
  }

  // Remove trailing commas (safe now: no comments, and we skip strings).
  let cleaned = ''
  inString = false
  for (let i = 0; i < out.length; i++) {
    const ch = out[i]
    if (inString) {
      cleaned += ch
      if (ch === '\\') {
        cleaned += out[i + 1] ?? ''
        i++
      } else if (ch === '"') {
        inString = false
      }
      continue
    }
    if (ch === '"') {
      inString = true
      cleaned += ch
      continue
    }
    if (ch === ',') {
      const rest = out.slice(i + 1)
      const nextMeaningful = rest.match(/\S/)
      if (
        nextMeaningful &&
        (nextMeaningful[0] === '}' || nextMeaningful[0] === ']')
      ) {
        continue
      }
    }
    cleaned += ch
  }

  return cleaned
}

const appDomain = process.env.APP_DOMAIN

if (!appDomain) {
  console.error('APP_DOMAIN is required')
  process.exit(1)
}

const configPath = new URL('../wrangler.jsonc', import.meta.url)
const config = JSON.parse(jsoncToJson(readFileSync(configPath, 'utf8')))

if (process.env.WORKER_NAME) {
  config.name = process.env.WORKER_NAME
}

// Point the D1 binding at the real database Pulumi created (the checked-in
// config holds a local-dev placeholder id). Both `wrangler d1 migrations
// apply` and `wrangler deploy` read this.
if (process.env.D1_DATABASE_ID) {
  config.d1_databases[0].database_id = process.env.D1_DATABASE_ID
}
if (process.env.D1_DATABASE_NAME) {
  config.d1_databases[0].database_name = process.env.D1_DATABASE_NAME
}

// Serve exclusively on the custom domain; Access protects this hostname.
config.routes = [{ pattern: appDomain, custom_domain: true }]
config.workers_dev = false
config.preview_urls = false

config.vars = {
  ...config.vars,
  BETTER_AUTH_URL: `https://${appDomain}`,
  APP_DOMAIN: appDomain,
  ...(process.env.R2_BUCKET_NAME
    ? { R2_BUCKET_NAME: process.env.R2_BUCKET_NAME }
    : {}),
  // Transactional email sender; defaults to noreply@APP_DOMAIN at runtime.
  ...(process.env.FROM_EMAIL_ADDRESS
    ? { FROM_EMAIL_ADDRESS: process.env.FROM_EMAIL_ADDRESS }
    : {}),
}

const output = JSON.stringify(config, null, 2)

if (process.argv.includes('--write')) {
  writeFileSync(configPath, output)
  console.log(`wrangler.jsonc rewritten for production deploy (${appDomain})`)
} else {
  console.log(output)
}
