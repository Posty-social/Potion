import { createServerFn } from '@tanstack/react-start'
import { getRequestHeaders } from '@tanstack/react-start/server'
import { AwsClient } from 'aws4fetch'

import { getRuntimeEnv } from '#/lib/db/connection'
import { requireWorkspaceAccess } from '#/lib/workspace/access'
import { resolveWorkspaceAccess } from '#/lib/workspace/access.server'

import {
  assetUploadIntentSchema,
  buildR2AssetKey,
  missingR2SigningVariables,
} from './intents'

// A minted upload URL is single-purpose: PUT only, one server-chosen key,
// signed content-type AND content-length (the uploaded bytes must match the
// validated intent or R2 rejects the signature), and a short lifetime.
const PUT_URL_EXPIRY_SECONDS = 300

function r2Signer() {
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
 * Mint a presigned R2 PUT for a page-media upload. Auth-gated to workspace
 * members; the mime/size were validated against the image/video allowlist by
 * the schema. When R2 signing credentials aren't configured (local dev), the
 * client falls back to uploading through the app at POST /api/assets/upload.
 */
export const createAssetUploadIntent = createServerFn({ method: 'POST' })
  .validator(assetUploadIntentSchema)
  .handler(async ({ data }) => {
    requireWorkspaceAccess(await resolveWorkspaceAccess(getRequestHeaders()))

    const signer = r2Signer()
    const key = buildR2AssetKey({
      assetId: crypto.randomUUID(),
      fileName: data.fileName,
    })
    // The stable app URL the block stores; GET /api/assets/$ authenticates
    // and redirects to a fresh presigned GET.
    const servePath = `/api/${key}`
    const headers = { 'content-type': data.mime }

    if (!signer.aws) {
      return {
        configured: false as const,
        missing: signer.missing,
        key,
        servePath,
        uploadUrl: null,
        headers,
      }
    }

    const request = await signer.aws.sign(
      signer.objectUrl(key, PUT_URL_EXPIRY_SECONDS),
      {
        method: 'PUT',
        headers: {
          ...headers,
          'content-length': String(data.sizeBytes),
        },
        aws: { signQuery: true, service: 's3', region: 'auto' },
      },
    )

    return {
      configured: true as const,
      missing: [] as string[],
      key,
      servePath,
      uploadUrl: request.url,
      headers,
    }
  })

/**
 * Presign a GET for an asset key, for the serving route's redirect. Not a
 * server function — only callable from server code that has already
 * authenticated the requester.
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
