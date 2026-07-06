import { z } from 'zod'

export const maxAssetUploadBytes = 50 * 1024 * 1024

export const assetUploadIntentSchema = z.object({
  fileName: z.string().min(1).max(180),
  mime: z.string().regex(/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i),
  sizeBytes: z.number().int().min(1).max(maxAssetUploadBytes),
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
