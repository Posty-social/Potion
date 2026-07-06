import { z } from 'zod'

const pageDocSocketMessageTypeSchema = z.enum([
  'presence',
  'block:update',
  'block:create',
  'block:delete',
  'row:update',
])

export const pageDocSocketMessageSchema = z.object({
  type: pageDocSocketMessageTypeSchema,
  pageId: z.string().min(1).max(120),
  clientId: z.string().min(1).max(120),
  payload: z.record(z.string(), z.unknown()).default({}),
})

export type PageDocSocketMessage = z.infer<typeof pageDocSocketMessageSchema>

export type PageDocSession = {
  pageId: string
  userId: string
  clientId: string
}

export type PageDocBroadcast = PageDocSocketMessage & {
  server: {
    userId: string
    receivedAt: string
  }
}

export function createPageDocSessionFromHeaders(
  headers: Headers,
): PageDocSession | null {
  const pageId = headers.get('x-potion-page-id')?.trim()
  const userId = headers.get('x-potion-user-id')?.trim()
  const clientId = headers.get('x-potion-client-id')?.trim()

  if (!pageId || !userId || !clientId) {
    return null
  }

  return {
    pageId,
    userId,
    clientId,
  }
}

export function parsePageDocSocketMessage(message: string | ArrayBuffer) {
  const raw =
    typeof message === 'string' ? message : new TextDecoder().decode(message)

  try {
    return pageDocSocketMessageSchema.safeParse(JSON.parse(raw))
  } catch {
    return pageDocSocketMessageSchema.safeParse(null)
  }
}

export function canBroadcastPageDocMessage(
  session: PageDocSession,
  message: PageDocSocketMessage,
) {
  return (
    session.pageId === message.pageId && session.clientId === message.clientId
  )
}

export function createPageDocBroadcast(
  session: PageDocSession,
  message: PageDocSocketMessage,
  receivedAt = new Date().toISOString(),
): PageDocBroadcast {
  return {
    ...message,
    server: {
      userId: session.userId,
      receivedAt,
    },
  }
}
