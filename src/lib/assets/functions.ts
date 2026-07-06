import { createServerFn } from '@tanstack/react-start'
import { AwsClient } from 'aws4fetch'

import { getRuntimeEnv } from '#/lib/db/connection'

import {
  assetUploadIntentSchema,
  buildR2AssetKey,
  missingR2SigningVariables,
} from './intents'

export const createAssetUploadIntent = createServerFn({ method: 'POST' })
  .validator(assetUploadIntentSchema)
  .handler(async ({ data }) => {
    const env = getRuntimeEnv()
    const accountId = env.CLOUDFLARE_ACCOUNT_ID
    const bucketName = env.R2_BUCKET_NAME
    const accessKeyId = env.R2_ACCESS_KEY_ID
    const secretAccessKey = env.R2_SECRET_ACCESS_KEY
    const missing = missingR2SigningVariables({
      CLOUDFLARE_ACCOUNT_ID: accountId,
      R2_BUCKET_NAME: bucketName,
      R2_ACCESS_KEY_ID: accessKeyId,
      R2_SECRET_ACCESS_KEY: secretAccessKey,
    })
    const assetId = crypto.randomUUID()
    const key = buildR2AssetKey({ assetId, fileName: data.fileName })
    const headers = { 'content-type': data.mime }

    if (!accountId || !bucketName || !accessKeyId || !secretAccessKey) {
      return {
        configured: false,
        reason: 'missing_r2_signing_variables',
        missing,
        assetId,
        key,
        method: 'PUT',
        uploadUrl: null,
        headers,
      }
    }

    const aws = new AwsClient({
      accessKeyId,
      secretAccessKey,
      service: 's3',
      region: 'auto',
    })
    const request = await aws.sign(
      `https://${accountId}.r2.cloudflarestorage.com/${bucketName}/${key}`,
      {
        method: 'PUT',
        headers,
        aws: { signQuery: true, service: 's3', region: 'auto' },
      },
    )

    return {
      configured: true,
      reason: null,
      missing: [],
      assetId,
      key,
      method: 'PUT',
      uploadUrl: request.url,
      headers,
    }
  })
