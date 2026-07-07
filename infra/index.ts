import * as cloudflare from '@pulumi/cloudflare'
import * as pulumi from '@pulumi/pulumi'

function requiredEnv(name: string): string {
  const value = process.env[name]

  if (!value) {
    throw new Error(`${name} is required`)
  }

  return value
}

const accountId = requiredEnv('CLOUDFLARE_ACCOUNT_ID')
const appDomain = requiredEnv('APP_DOMAIN')
const workerName = process.env.WORKER_NAME || 'potion'
const d1DatabaseName = process.env.D1_DATABASE_NAME || `${workerName}-db`
const r2BucketName = process.env.R2_BUCKET_NAME || `${workerName}-assets`

const database = new cloudflare.D1Database('database', {
  accountId,
  name: d1DatabaseName,
  // Serve reads from replicas near the worker; the app opens a D1 Session
  // per request (src/server.ts) so reads stay monotonically consistent.
  readReplication: { mode: 'auto' },
})

const assets = new cloudflare.R2Bucket('assets', {
  accountId,
  name: r2BucketName,
  storageClass: 'Standard',
})

const assetsCors = new cloudflare.R2BucketCors(
  'assets-cors',
  {
    accountId,
    bucketName: r2BucketName,
    rules: [
      {
        id: 'browser-direct-upload',
        allowed: {
          methods: ['GET', 'PUT', 'HEAD'],
          origins: [`https://${appDomain}`],
          headers: ['*'],
        },
        exposeHeaders: ['etag'],
        maxAgeSeconds: 3600,
      },
    ],
  },
  { dependsOn: assets },
)

// --- Cloudflare Zero Trust (Access) ---------------------------------------
// When ZERO_TRUST_EMAILS is set (comma-separated), the app domain is placed
// behind Cloudflare Access with an allow policy for exactly those emails.
// Access is default-deny: everyone else is blocked at the edge before the
// Worker runs. When the variable is unset, no Access resources exist (and a
// subsequent `pulumi up` removes previously created ones).
const zeroTrustEmails = (process.env.ZERO_TRUST_EMAILS ?? '')
  .split(',')
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean)

// How long an Access login stays valid before re-authentication. Long-lived
// (1 year) so allowed users rarely have to log in again at the edge.
const accessSessionDuration = '8760h'

let accessApplication: cloudflare.ZeroTrustAccessApplication | undefined

if (zeroTrustEmails.length > 0) {
  const allowlist = new cloudflare.ZeroTrustAccessPolicy(
    'workspace-allowlist',
    {
      accountId,
      name: `${workerName} allowed emails`,
      decision: 'allow',
      includes: zeroTrustEmails.map((email) => ({ email: { email } })),
    },
  )

  accessApplication = new cloudflare.ZeroTrustAccessApplication(
    'workspace-access',
    {
      accountId,
      name: `${workerName} workspace`,
      domain: appDomain,
      type: 'self_hosted',
      sessionDuration: accessSessionDuration,
      policies: [{ id: allowlist.id, precedence: 1 }],
    },
  )

  // The MCP server and its OAuth handshake must be reachable by remote MCP
  // clients, which can't complete Access's interactive browser login. Carve
  // the MCP + OAuth endpoints out of Access with a public bypass — they stay
  // protected by the app's own Better Auth OAuth (unauthenticated calls get
  // 401). Cloudflare Access matches the most specific path, so this bypass
  // wins for these paths while the rest of the domain stays gated.
  const mcpBypass = new cloudflare.ZeroTrustAccessPolicy('mcp-public-bypass', {
    accountId,
    name: `${workerName} mcp public bypass`,
    decision: 'bypass',
    includes: [{ everyone: {} }],
  })

  new cloudflare.ZeroTrustAccessApplication('workspace-mcp-public', {
    accountId,
    name: `${workerName} mcp (public)`,
    type: 'self_hosted',
    sessionDuration: accessSessionDuration,
    // Public destinations skip Access; paths support wildcards.
    destinations: [
      { type: 'public', uri: `${appDomain}/mcp` },
      { type: 'public', uri: `${appDomain}/mcp/*` },
      { type: 'public', uri: `${appDomain}/api/auth/mcp/*` },
      {
        type: 'public',
        uri: `${appDomain}/.well-known/oauth-authorization-server`,
      },
      {
        type: 'public',
        uri: `${appDomain}/.well-known/oauth-protected-resource`,
      },
    ],
    policies: [{ id: mcpBypass.id, precedence: 1 }],
  })
}

export const databaseId = database.id
export const databaseName = database.name
export const bucketName = assets.name
export const corsRulesId = assetsCors.id
export const domain = pulumi.output(appDomain)
export const zeroTrustEnabled = pulumi.output(zeroTrustEmails.length > 0)
export const accessApplicationId = accessApplication
  ? accessApplication.id
  : pulumi.output(undefined)
