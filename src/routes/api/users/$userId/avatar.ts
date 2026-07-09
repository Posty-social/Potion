import { createFileRoute } from '@tanstack/react-router'

import { getRuntimeEnv } from '#/lib/db/connection'
import { hasWorkspaceAccess } from '#/lib/workspace/access'
import { resolveWorkspaceAccess } from '#/lib/workspace/access.server'

const MAX_AVATAR_BYTES = 5 * 1024 * 1024

/** R2 object key for a user's profile picture (assets bucket). */
function avatarKey(userId: string) {
  return `users/${userId}/profile`
}

export const Route = createFileRoute('/api/users/$userId/avatar')({
  server: {
    handlers: {
      // Serve a user's profile picture to any signed-in workspace user.
      GET: async ({ params, request }) => {
        const access = await resolveWorkspaceAccess(request.headers)

        if (!hasWorkspaceAccess(access)) {
          return Response.json({ error: 'unauthenticated' }, { status: 401 })
        }

        const object = await getRuntimeEnv().ASSETS.get(
          avatarKey(params.userId),
        )

        if (!object) {
          return Response.json({ error: 'not_found' }, { status: 404 })
        }

        return new Response(object.body as BodyInit, {
          headers: {
            'content-type':
              object.httpMetadata?.contentType ?? 'application/octet-stream',
            // Short cache so a replaced picture shows up quickly; the client
            // also busts with a ?v= param right after uploading.
            'cache-control': 'private, max-age=60',
            etag: object.httpEtag,
          },
        })
      },

      // Upload your own profile picture (raw image body → R2).
      PUT: async ({ params, request }) => {
        const access = await resolveWorkspaceAccess(request.headers)

        if (!hasWorkspaceAccess(access) || !access.user) {
          return Response.json({ error: 'unauthenticated' }, { status: 401 })
        }

        if (access.user.id !== params.userId) {
          return Response.json({ error: 'forbidden' }, { status: 403 })
        }

        const contentType = request.headers.get('content-type') ?? ''
        if (!contentType.startsWith('image/')) {
          return Response.json({ error: 'not_an_image' }, { status: 400 })
        }

        const bytes = await request.arrayBuffer()
        if (bytes.byteLength === 0 || bytes.byteLength > MAX_AVATAR_BYTES) {
          return Response.json({ error: 'invalid_size' }, { status: 400 })
        }

        await getRuntimeEnv().ASSETS.put(avatarKey(access.user.id), bytes, {
          httpMetadata: { contentType },
        })

        return Response.json({ ok: true })
      },
    },
  },
})
