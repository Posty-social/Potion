import { createFileRoute } from '@tanstack/react-router'

import { buildR2AssetKey } from '#/lib/assets/intents'
import { getRuntimeEnv } from '#/lib/db/connection'
import { hasWorkspaceAccess } from '#/lib/workspace/access'
import { resolveWorkspaceAccess } from '#/lib/workspace/access.server'

const MAX_IMAGE_BYTES = 10 * 1024 * 1024

export const Route = createFileRoute('/api/assets/$')({
  server: {
    handlers: {
      // Serve an uploaded asset (R2 key `assets/<assetId>/<fileName>`) to any
      // signed-in workspace user. Keys embed a fresh UUID per upload, so the
      // content behind a URL never changes — cache it hard.
      GET: async ({ params, request }) => {
        const access = await resolveWorkspaceAccess(request.headers)

        if (!hasWorkspaceAccess(access)) {
          return Response.json({ error: 'unauthenticated' }, { status: 401 })
        }

        const object = await getRuntimeEnv().ASSETS.get(
          `assets/${params._splat ?? ''}`,
        )

        if (!object) {
          return Response.json({ error: 'not_found' }, { status: 404 })
        }

        return new Response(object.body as BodyInit, {
          headers: {
            'content-type':
              object.httpMetadata?.contentType ?? 'application/octet-stream',
            'cache-control': 'private, max-age=31536000, immutable',
            etag: object.httpEtag,
          },
        })
      },

      // Upload an image for a page block (raw image body → R2). POST to
      // /api/assets/upload with the file as the body, its MIME type as
      // content-type, and the original name in x-file-name. Returns the
      // app-relative URL an image block stores as its content.
      POST: async ({ request }) => {
        const access = await resolveWorkspaceAccess(request.headers)

        if (!hasWorkspaceAccess(access)) {
          return Response.json({ error: 'unauthenticated' }, { status: 401 })
        }

        const contentType = request.headers.get('content-type') ?? ''
        if (!contentType.startsWith('image/')) {
          return Response.json({ error: 'not_an_image' }, { status: 400 })
        }

        const bytes = await request.arrayBuffer()
        if (bytes.byteLength === 0 || bytes.byteLength > MAX_IMAGE_BYTES) {
          return Response.json({ error: 'invalid_size' }, { status: 400 })
        }

        const key = buildR2AssetKey({
          assetId: crypto.randomUUID(),
          fileName: request.headers.get('x-file-name') ?? 'image',
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
