import { z } from 'zod'

export const maxImageUploadBytes = 10 * 1024 * 1024
export const maxVideoUploadBytes = 50 * 1024 * 1024

/**
 * Upload size limit for an asset MIME type, or null when the type isn't
 * allowed at all. Only images and videos may be uploaded.
 */
export function assetUploadLimit(mime: string): number | null {
  if (mime.startsWith('image/')) {
    return maxImageUploadBytes
  }
  if (mime.startsWith('video/')) {
    return maxVideoUploadBytes
  }
  return null
}

export const assetUploadIntentSchema = z
  .object({
    fileName: z.string().min(1).max(180),
    mime: z.string().regex(/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i),
    sizeBytes: z.number().int().min(1),
  })
  .superRefine((data, ctx) => {
    const limit = assetUploadLimit(data.mime)
    if (limit === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['mime'],
        message: 'Only image and video uploads are allowed.',
      })
    } else if (data.sizeBytes > limit) {
      ctx.addIssue({
        code: 'custom',
        path: ['sizeBytes'],
        message: `File is too large (max ${Math.round(limit / 1024 / 1024)}MB).`,
      })
    }
  })

export type AssetUploadIntentInput = z.infer<typeof assetUploadIntentSchema>

export function sanitizeAssetFileName(fileName: string) {
  return (
    fileName
      .trim()
      .replace(/[/\\?%*:|"<>]/g, '-')
      .replace(/\s+/g, '-')
      .slice(0, 120) || 'upload'
  )
}

export function buildR2AssetKey({
  assetId,
  fileName,
}: {
  assetId: string
  fileName: string
}) {
  return `assets/${assetId}/${sanitizeAssetFileName(fileName)}`
}

export function missingR2SigningVariables(env: {
  CLOUDFLARE_ACCOUNT_ID?: string
  R2_BUCKET_NAME?: string
  R2_ACCESS_KEY_ID?: string
  R2_SECRET_ACCESS_KEY?: string
}) {
  return [
    ['CLOUDFLARE_ACCOUNT_ID', env.CLOUDFLARE_ACCOUNT_ID],
    ['R2_BUCKET_NAME', env.R2_BUCKET_NAME],
    ['R2_ACCESS_KEY_ID', env.R2_ACCESS_KEY_ID],
    ['R2_SECRET_ACCESS_KEY', env.R2_SECRET_ACCESS_KEY],
  ]
    .filter(([, value]) => !value)
    .map(([key]) => key)
}
