import { createFileRoute } from '@tanstack/react-router'

import { presignAssetGet } from '#/lib/assets/functions'
import {
  assetUploadLimit,
  buildR2AssetKey,
  missingR2SigningVariables,
} from '#/lib/assets/intents'
import { getRuntimeEnv } from '#/lib/db/connection'
import { hasWorkspaceAccess } from '#/lib/workspace/access'
import { resolveWorkspaceAccess } from '#/lib/workspace/access.server'

// Presigned GETs outlive the redirect cache comfortably so a cached redirect
// never points at an expired signature.
const GET_URL_EXPIRY_SECONDS = 900
const REDIRECT_CACHE_SECONDS = 300

/** Parse a single-range `Range` header into R2 get options. */
function parseRange(
  header: string | null,
): { offset: number; length?: number } | { suffix: number } | null {
  const match = header?.match(/^bytes=(\d*)-(\d*)$/)

  if (!match || (!match[1] && !match[2])) {
    return null
  }

  if (!match[1]) {
    return { suffix: Number(match[2]) }
  }

  const offset = Number(match[1])
  return match[2]
    ? { offset, length: Number(match[2]) - offset + 1 }
    : { offset }
}

export const Route = createFileRoute('/api/assets/$')({
  server: {
    handlers: {
      // Serve an uploaded asset (R2 key `assets/<assetId>/<fileName>`) to any
      // signed-in workspace user — by redirecting to a short-lived presigned
      // R2 GET. R2 then handles Range requests natively, which <video> needs
      // for seeking. Without signing credentials (local dev) the object is
      // streamed through the app instead, with single-range support.
      GET: async ({ params, request }) => {
        const access = await resolveWorkspaceAccess(request.headers)

        if (!hasWorkspaceAccess(access)) {
          return Response.json({ error: 'unauthenticated' }, { status: 401 })
        }

        const key = `assets/${params._splat ?? ''}`
        const presigned = await presignAssetGet(key, GET_URL_EXPIRY_SECONDS)

        if (presigned) {
          return new Response(null, {
            status: 302,
            headers: {
              location: presigned,
              'cache-control': `private, max-age=${REDIRECT_CACHE_SECONDS}`,
            },
          })
        }

        const range = parseRange(request.headers.get('range'))
        let object: R2ObjectBody | null = null

        try {
          object = await getRuntimeEnv().ASSETS.get(
            key,
            range ? { range } : undefined,
          )
        } catch {
          // R2 throws when the requested range is unsatisfiable.
          return new Response(null, { status: 416 })
        }

        if (!object) {
          return Response.json({ error: 'not_found' }, { status: 404 })
        }

        const headers = new Headers({
          'content-type':
            object.httpMetadata?.contentType ?? 'application/octet-stream',
          'cache-control': 'private, max-age=31536000, immutable',
          'accept-ranges': 'bytes',
          etag: object.httpEtag,
        })

        if (range && object.range && 'offset' in object.range) {
          const offset = object.range.offset ?? 0
          const length = object.range.length ?? object.size - offset
          headers.set(
            'content-range',
            `bytes ${offset}-${offset + length - 1}/${object.size}`,
          )
          headers.set('content-length', String(length))
          return new Response(object.body as BodyInit, {
            status: 206,
            headers,
          })
        }

        return new Response(object.body as BodyInit, { headers })
      },

      // Local-dev fallback upload (raw body → R2 binding), used only when R2
      // signing credentials are absent. When presigned uploads are available
      // this endpoint refuses, so production traffic can't route around the
      // presigned flow.
      POST: async ({ request }) => {
        const access = await resolveWorkspaceAccess(request.headers)

        if (!hasWorkspaceAccess(access)) {
          return Response.json({ error: 'unauthenticated' }, { status: 401 })
        }

        if (missingR2SigningVariables(getRuntimeEnv()).length === 0) {
          return Response.json(
            { error: 'use_presigned_upload' },
            { status: 409 },
          )
        }

        const contentType = request.headers.get('content-type') ?? ''
        const maxBytes = assetUploadLimit(contentType)

        if (maxBytes === null) {
          return Response.json({ error: 'unsupported_type' }, { status: 400 })
        }

        const bytes = await request.arrayBuffer()

        if (bytes.byteLength === 0 || bytes.byteLength > maxBytes) {
          return Response.json({ error: 'invalid_size' }, { status: 400 })
        }

        const key = buildR2AssetKey({
          assetId: crypto.randomUUID(),
          fileName: request.headers.get('x-file-name') ?? 'upload',
        })

        await getRuntimeEnv().ASSETS.put(key, bytes, {
          httpMetadata: { contentType },
        })

        // `key` is `assets/<assetId>/<fileName>`, served by GET above.
        return Response.json({ url: `/api/${key}` })
      },
    },
  },
})
