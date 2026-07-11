import { AwsClient } from 'aws4fetch'

import { getRuntimeEnv } from '#/lib/db/connection'

import { missingR2SigningVariables } from './intents'

/**
 * Server-only R2 presigning. Lives apart from the server-function module so
 * client code importing that module never pulls the Workers runtime
 * (`cloudflare:workers` via db/connection) into the browser bundle.
 */
export function r2Signer() {
  const env = getRuntimeEnv()
  const accountId = env.CLOUDFLARE_ACCOUNT_ID
  const bucketName = env.R2_BUCKET_NAME
  const accessKeyId = env.R2_ACCESS_KEY_ID
  const secretAccessKey = env.R2_SECRET_ACCESS_KEY

  if (!accountId || !bucketName || !accessKeyId || !secretAccessKey) {
    return { aws: null, missing: missingR2SigningVariables(env) }
  }

  return {
    aws: new AwsClient({
      accessKeyId,
      secretAccessKey,
      service: 's3',
      region: 'auto',
    }),
    missing: [] as string[],
    objectUrl: (key: string, expirySeconds: number) =>
      `https://${accountId}.r2.cloudflarestorage.com/${bucketName}/${key}?X-Amz-Expires=${expirySeconds}`,
  }
}

/**
 * Presign a GET for an asset key, for the serving route's redirect. Only
 * callable from server code that has already authenticated the requester.
 */
export async function presignAssetGet(
  key: string,
  expirySeconds: number,
): Promise<string | null> {
  const signer = r2Signer()

  if (!signer.aws) {
    return null
  }

  const request = await signer.aws.sign(signer.objectUrl(key, expirySeconds), {
    method: 'GET',
    aws: { signQuery: true, service: 's3', region: 'auto' },
  })

  return request.url
}
