import { createFileRoute } from '@tanstack/react-router'

import { presignAssetGet } from '#/lib/assets/r2.server'
import { hasWorkspaceAccess } from '#/lib/workspace/access'
import { resolveWorkspaceAccess } from '#/lib/workspace/access.server'

// Presigned GETs outlive the redirect cache comfortably so a cached redirect
// never points at an expired signature.
const GET_URL_EXPIRY_SECONDS = 900
const REDIRECT_CACHE_SECONDS = 300

export const Route = createFileRoute('/api/assets/$')({
  server: {
    handlers: {
      // Serve an uploaded asset (R2 key `assets/<assetId>/<fileName>`) to any
      // signed-in workspace user by redirecting to a short-lived presigned R2
      // GET. R2 then serves the bytes (and handles Range requests natively,
      // which <video> needs for seeking) — nothing streams through the Worker.
      // Uploads are presigned PUTs straight to R2; there is no upload path here.
      GET: async ({ params, request }) => {
        const access = await resolveWorkspaceAccess(request.headers)

        if (!hasWorkspaceAccess(access)) {
          return Response.json({ error: 'unauthenticated' }, { status: 401 })
        }

        const key = `assets/${params._splat ?? ''}`
        const presigned = await presignAssetGet(key, GET_URL_EXPIRY_SECONDS)

        if (!presigned) {
          return Response.json({ error: 'not_configured' }, { status: 500 })
        }

        return new Response(null, {
          status: 302,
          headers: {
            location: presigned,
            'cache-control': `private, max-age=${REDIRECT_CACHE_SECONDS}`,
          },
        })
      },
    },
  },
})
