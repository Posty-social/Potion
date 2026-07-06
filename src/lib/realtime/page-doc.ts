export type PageDocSocketMessage = {
  type:
    | 'presence'
    | 'block:update'
    | 'block:create'
    | 'block:delete'
    | 'row:update'
  pageId: string
  clientId: string
  payload: Record<string, unknown>
}

export class PageDoc implements DurableObject {
  constructor(private readonly state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected WebSocket upgrade', { status: 426 })
    }

    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket]

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
    const payload =
      typeof message === 'string' ? message : new TextDecoder().decode(message)

    for (const socket of this.state.getWebSockets()) {
      if (socket !== webSocket) {
        socket.send(payload)
      }
    }
  }

  async webSocketClose(webSocket: WebSocket): Promise<void> {
    webSocket.close(1000, 'closed')
  }
}
