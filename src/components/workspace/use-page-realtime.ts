import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import type { PageDocViewer } from '#/lib/realtime/messages'

export type { PageDocViewer }

// One realtime identity per tab: distinguishes two tabs of the same user so
// both edits and presence work across a user's own windows.
let tabClientId: string | null = null

function getTabClientId(): string {
  tabClientId ??= `client_${crypto.randomUUID()}`

  return tabClientId
}

/**
 * Live connection to the page's Durable Object over WebSocket.
 * - `doc:update` broadcasts (sent by the server after any write, including
 *   other users and MCP agents) refetch the workspace queries, so every open
 *   tab converges without manual reloads.
 * - `presence:state` broadcasts keep a list of who else is viewing the page.
 *
 * Reconnects with capped exponential backoff. This is real external-system
 * synchronization, which is what `useEffect` is for — data itself still lives
 * in TanStack Query.
 */
export function usePageRealtime(pageId: string): PageDocViewer[] {
  const queryClient = useQueryClient()
  const [viewers, setViewers] = useState<PageDocViewer[]>([])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const clientId = getTabClientId()
    let socket: WebSocket | null = null
    let disposed = false
    let attempts = 0
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined

    const connect = () => {
      const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
      socket = new WebSocket(
        `${protocol}://${window.location.host}/api/realtime/pages/${pageId}?client=${clientId}`,
      )

      socket.addEventListener('open', () => {
        attempts = 0
      })

      socket.addEventListener('message', (event) => {
        let message: { type?: string; viewers?: PageDocViewer[] }
        try {
          message = JSON.parse(String(event.data)) as typeof message
        } catch {
          return
        }

        if (message.type === 'doc:update') {
          // Another tab, user, or MCP agent changed this page: refetch.
          void queryClient.invalidateQueries({ queryKey: ['workspace'] })
        } else if (message.type === 'presence:state') {
          setViewers(
            (message.viewers ?? []).filter(
              (viewer) => viewer.clientId !== clientId,
            ),
          )
        }
      })

      socket.addEventListener('close', () => {
        if (disposed) {
          return
        }
        setViewers([])
        // Capped exponential backoff: 1s, 2s, 4s … 30s.
        const delay = Math.min(30_000, 1000 * 2 ** attempts)
        attempts += 1
        reconnectTimer = setTimeout(connect, delay)
      })
    }

    connect()

    return () => {
      disposed = true
      clearTimeout(reconnectTimer)
      socket?.close()
      setViewers([])
    }
  }, [pageId, queryClient])

  return viewers
}
