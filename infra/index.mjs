import * as cloudflare from '@pulumi/cloudflare'
import * as pulumi from '@pulumi/pulumi'

function requiredEnv(name) {
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

let accessApplication

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
      sessionDuration: '24h',
      policies: [{ id: allowlist.id, precedence: 1 }],
    },
  )
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
