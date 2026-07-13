import { createServerFn } from '@tanstack/react-start'
import { getRequestHeaders } from '@tanstack/react-start/server'

import { requireWorkspaceAccess } from '#/lib/workspace/access'
import { resolveWorkspaceAccess } from '#/lib/workspace/access.server'

import { assetUploadIntentSchema, buildR2AssetKey } from './intents'
import { r2Signer } from './r2.server'

// A minted upload URL is single-purpose: PUT only, one server-chosen key,
// signed content-type AND content-length (the uploaded bytes must match the
// validated intent or R2 rejects the signature), and a short lifetime.
const PUT_URL_EXPIRY_SECONDS = 300

/**
 * Mint a presigned R2 PUT for a page-media upload. Auth-gated to workspace
 * members; the mime/size were validated against the image/video allowlist by
 * the schema. The browser uploads straight to R2 with this URL — there is no
 * upload-through-the-Worker path. Throws if R2 signing isn't configured (the
 * signing vars must be present in every environment that allows uploads).
 */
export const createAssetUploadIntent = createServerFn({ method: 'POST' })
  .validator(assetUploadIntentSchema)
  .handler(async ({ data }) => {
    requireWorkspaceAccess(await resolveWorkspaceAccess(getRequestHeaders()))

    const signer = r2Signer()
    if (!signer.aws) {
      throw new Error(
        `Asset uploads are not configured (missing ${signer.missing.join(', ')}).`,
      )
    }

    const key = buildR2AssetKey({
      assetId: crypto.randomUUID(),
      fileName: data.fileName,
    })
    const request = await signer.aws.sign(
      signer.objectUrl(key, PUT_URL_EXPIRY_SECONDS),
      {
        method: 'PUT',
        headers: {
          'content-type': data.mime,
          'content-length': String(data.sizeBytes),
        },
        aws: { signQuery: true, service: 's3', region: 'auto' },
      },
    )

    return {
      key,
      // The stable app URL the block stores; GET /api/assets/$ authenticates
      // and redirects to a fresh presigned GET.
      servePath: `/api/${key}`,
      uploadUrl: request.url,
      headers: { 'content-type': data.mime },
    }
  })
