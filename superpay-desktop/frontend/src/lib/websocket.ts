import { useEffect, useRef } from 'react'

type EventHandler = (data: unknown) => void

class WebSocketClient {
  private ws: WebSocket | null = null
  private url: string
  private listeners: Map<string, Set<EventHandler>> = new Map()
  private reconnectAttempts = 0
  private maxReconnectAttempts = 10
  private reconnectDelay = 1000

  constructor(url: string) {
    this.url = url
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        // Use the dynamic server URL if available (Wails mode)
        let wsUrl: string
        const apiBase = (window as any).__SUPERPAY_API_BASE__
        if (apiBase) {
          // Convert http://127.0.0.1:PORT/api to ws://127.0.0.1:PORT/api/ws
          wsUrl = apiBase.replace(/^http/, 'ws') + '/ws'
        } else {
          const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
          wsUrl = `${protocol}://${window.location.host}${this.url}`
        }
        this.ws = new WebSocket(wsUrl)

        this.ws.onopen = () => {
          console.log('WebSocket connected')
          this.reconnectAttempts = 0
          resolve()
        }

        this.ws.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data)
            const { event_type: type, data } = message
            this.emit(type, data)
          } catch (e) {
            console.error('Failed to parse WebSocket message:', e)
          }
        }

        this.ws.onerror = (error) => {
          console.error('WebSocket error:', error)
          reject(error)
        }

        this.ws.onclose = () => {
          console.log('WebSocket disconnected')
          this.attemptReconnect()
        }
      } catch (e) {
        reject(e)
      }
    })
  }

  private attemptReconnect() {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++
      const delay = Math.min(this.reconnectDelay * Math.pow(2, this.reconnectAttempts), 30000)
      console.log(`Attempting to reconnect in ${delay}ms (attempt ${this.reconnectAttempts})`)
      setTimeout(() => this.connect().catch(console.error), delay)
    } else {
      console.error('Max reconnection attempts reached')
    }
  }

  on(event: string, handler: EventHandler) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set())
    }
    this.listeners.get(event)!.add(handler)

    return () => {
      this.listeners.get(event)?.delete(handler)
    }
  }

  off(event: string, handler: EventHandler) {
    this.listeners.get(event)?.delete(handler)
  }

  private emit(event: string, data: unknown) {
    const handlers = this.listeners.get(event)
    if (handlers) {
      handlers.forEach((handler) => {
        try {
          handler(data)
        } catch (e) {
          console.error(`Error in event handler for ${event}:`, e)
        }
      })
    }
  }

  disconnect() {
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }
}

let wsClient: WebSocketClient | null = null

export function getWebSocketClient(): WebSocketClient {
  if (!wsClient) {
    wsClient = new WebSocketClient('/api/ws')
  }
  return wsClient
}

export function useWebSocket(event: string, handler: (data: unknown) => void) {
  const client = getWebSocketClient()
  const handlerRef = useRef(handler)

  useEffect(() => {
    handlerRef.current = handler
  }, [handler])

  useEffect(() => {
    const unsubscribe = client.on(event, (data) => {
      handlerRef.current(data)
    })

    if (!client.isConnected()) {
      client.connect().catch(console.error)
    }

    return () => {
      unsubscribe()
    }
  }, [event, client])
}

export { WebSocketClient }
