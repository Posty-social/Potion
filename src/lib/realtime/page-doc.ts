import {
  canBroadcastPageDocMessage,
  createPageDocBroadcast,
  createPageDocSessionFromHeaders,
  createPresenceState,
  pageDocServerEventSchema,
  parsePageDocSocketMessage,
  viewerFromSession,
  type PageDocSession,
} from './messages'

/**
 * One Durable Object per page. Holds every open WebSocket for that page and:
 * - broadcasts `doc:update` events posted by the Worker after writes so every
 *   viewer (other tabs, other users, MCP edits) refetches,
 * - tracks presence: whenever a socket connects or disconnects, all viewers
 *   get a fresh `presence:state` listing who is on the page,
 * - relays client-to-client messages (typing, block edits) to same-page peers.
 */
export class PageDoc implements DurableObject {
  constructor(private readonly state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    // Server-initiated broadcast (from the Worker after a repository write).
    // Only reachable through the PAGE_DOC binding, never from the public edge.
    if (request.method === 'POST') {
      const event = pageDocServerEventSchema.safeParse(
        await request.json().catch(() => null),
      )

      if (!event.success) {
        return Response.json({ error: 'invalid_event' }, { status: 400 })
      }

      return Response.json({ delivered: this.broadcast(event.data) })
    }

    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected WebSocket upgrade', { status: 426 })
    }

    const session = createPageDocSessionFromHeaders(request.headers)

    if (!session) {
      return new Response('Missing realtime session', { status: 401 })
    }

    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket]

    server.serializeAttachment(session)
    this.state.acceptWebSocket(server)
    this.broadcastPresence()

    return new Response(null, {
      status: 101,
      webSocket: client,
    } as ResponseInit & { webSocket: WebSocket })
  }

  async webSocketMessage(
    webSocket: WebSocket,
    message: string | ArrayBuffer,
  ): Promise<void> {
    const session = webSocket.deserializeAttachment() as PageDocSession | null
    const parsed = parsePageDocSocketMessage(message)

    if (!session || !parsed.success) {
      webSocket.send(
        JSON.stringify({
          type: 'error',
          reason: 'invalid_realtime_message',
        }),
      )

      return
    }

    if (!canBroadcastPageDocMessage(session, parsed.data)) {
      webSocket.send(
        JSON.stringify({
          type: 'error',
          reason: 'unauthorized_realtime_message',
        }),
      )

      return
    }

    const payload = JSON.stringify(createPageDocBroadcast(session, parsed.data))

    for (const socket of this.state.getWebSockets()) {
      const socketSession =
        socket.deserializeAttachment() as PageDocSession | null

      if (socket !== webSocket && socketSession?.pageId === session.pageId) {
        this.trySend(socket, payload)
      }
    }
  }

  async webSocketClose(webSocket: WebSocket): Promise<void> {
    webSocket.close(1000, 'closed')
    this.broadcastPresence(webSocket)
  }

  async webSocketError(webSocket: WebSocket): Promise<void> {
    this.broadcastPresence(webSocket)
  }

  /** Send a JSON payload to every connected socket; returns delivery count. */
  private broadcast(event: unknown, exclude?: WebSocket): number {
    const payload = JSON.stringify(event)
    let delivered = 0

    for (const socket of this.state.getWebSockets()) {
      if (socket !== exclude && this.trySend(socket, payload)) {
        delivered += 1
      }
    }

    return delivered
  }

  /** Tell every remaining viewer who is on the page now. */
  private broadcastPresence(leaving?: WebSocket): void {
    const sessions = this.state
      .getWebSockets()
      .filter((socket) => socket !== leaving)
      .map((socket) => socket.deserializeAttachment() as PageDocSession | null)
      .filter((session): session is PageDocSession => session !== null)

    if (sessions.length === 0) {
      return
    }

    this.broadcast(
      createPresenceState(sessions[0].pageId, sessions.map(viewerFromSession)),
      leaving,
    )
  }

  private trySend(socket: WebSocket, payload: string): boolean {
    try {
      socket.send(payload)
      return true
    } catch {
      // Socket already closing; presence will settle on its close event.
      return false
    }
  }
}
