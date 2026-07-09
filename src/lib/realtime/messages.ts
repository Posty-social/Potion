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
  name: string
}

export type PageDocBroadcast = PageDocSocketMessage & {
  server: {
    userId: string
    receivedAt: string
  }
}

/** One live viewer of a page, as reported in presence broadcasts. */
export type PageDocViewer = {
  clientId: string
  userId: string
  name: string
}

/** Sent to every socket whenever a viewer joins or leaves the page. */
export type PageDocPresenceState = {
  type: 'presence:state'
  pageId: string
  viewers: PageDocViewer[]
}

/** Server-initiated event telling viewers the page content changed. */
export const pageDocServerEventSchema = z.object({
  type: z.literal('doc:update'),
  pageId: z.string().min(1).max(120),
})

export type PageDocServerEvent = z.infer<typeof pageDocServerEventSchema>

export function createPresenceState(
  pageId: string,
  viewers: PageDocViewer[],
): PageDocPresenceState {
  return { type: 'presence:state', pageId, viewers }
}

export function viewerFromSession(session: PageDocSession): PageDocViewer {
  return {
    clientId: session.clientId,
    userId: session.userId,
    name: session.name,
  }
}

export function createPageDocSessionFromHeaders(
  headers: Headers,
): PageDocSession | null {
  const pageId = headers.get('x-potion-page-id')?.trim()
  const userId = headers.get('x-potion-user-id')?.trim()
  const clientId = headers.get('x-potion-client-id')?.trim()
  const name = headers.get('x-potion-user-name')?.trim() || 'Someone'

  if (!pageId || !userId || !clientId) {
    return null
  }

  return {
    pageId,
    userId,
    clientId,
    name,
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
