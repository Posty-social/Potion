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

export const databaseId = database.id
export const databaseName = database.name
export const bucketName = assets.name
export const corsRulesId = assetsCors.id
export const domain = pulumi.output(appDomain)
