import {
  canBroadcastPageDocMessage,
  createPageDocBroadcast,
  createPageDocSessionFromHeaders,
  parsePageDocSocketMessage,
  type PageDocSession,
} from './messages'

export class PageDoc implements DurableObject {
  constructor(private readonly state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
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
        socket.send(payload)
      }
    }
  }

  async webSocketClose(webSocket: WebSocket): Promise<void> {
    webSocket.close(1000, 'closed')
  }
}
