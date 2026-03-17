import WebSocket from 'ws'
import { randomBytes } from 'crypto'
import { BrowserWindow } from 'electron'
import { PROXIED_EVENTS, type RemoteFrame } from './protocol'
import { logger } from '../logger'

interface PendingInvoke {
  resolve: (result: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export class RemoteClient {
  private ws: WebSocket | null = null
  private pending: Map<string, PendingInvoke> = new Map()
  private getWindows: () => BrowserWindow[]
  private _connected = false
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private host = ''
  private port = 0
  private token = ''
  private label = ''
  private shouldReconnect = false

  constructor(getWindows: () => BrowserWindow[]) {
    this.getWindows = getWindows
  }

  get isConnected(): boolean {
    return this._connected && this.ws?.readyState === WebSocket.OPEN
  }

  get connectionInfo(): { host: string; port: number } | null {
    if (!this._connected) return null
    return { host: this.host, port: this.port }
  }

  connect(host: string, port: number, token: string, label?: string): Promise<boolean> {
    if (this.ws) this.disconnect()

    this.host = host
    this.port = port
    this.token = token
    this.label = label || `Client-${randomBytes(3).toString('hex')}`
    this.shouldReconnect = true

    return this.doConnect()
  }

  private doConnect(): Promise<boolean> {
    return new Promise((resolve) => {
      const url = `ws://${this.host}:${this.port}`
      this.ws = new WebSocket(url)

      let authResolved = false

      const authTimeout = setTimeout(() => {
        if (!authResolved) {
          authResolved = true
          this._connected = false
          this.ws?.close()
          resolve(false)
        }
      }, 10000)

      this.ws.on('open', () => {
        // Send auth frame
        const authFrame: RemoteFrame = {
          type: 'auth',
          id: this.nextId(),
          token: this.token,
          args: [this.label]
        }
        this.ws!.send(JSON.stringify(authFrame))
      })

      this.ws.on('message', (raw) => {
        let frame: RemoteFrame
        try {
          frame = JSON.parse(raw.toString())
        } catch {
          return
        }

        // Auth result
        if (frame.type === 'auth-result') {
          clearTimeout(authTimeout)
          if (!authResolved) {
            authResolved = true
            if (frame.error) {
              this._connected = false
              logger.error(`[RemoteClient] Auth failed: ${frame.error}`)
              resolve(false)
            } else {
              this._connected = true
              logger.log(`[RemoteClient] Connected to ${this.host}:${this.port}`)
              resolve(true)
            }
          }
          return
        }

        // Invoke result
        if (frame.type === 'invoke-result' || frame.type === 'invoke-error') {
          const pending = this.pending.get(frame.id)
          if (pending) {
            clearTimeout(pending.timer)
            this.pending.delete(frame.id)
            if (frame.type === 'invoke-error') {
              pending.reject(new Error(frame.error || 'Remote invoke failed'))
            } else {
              pending.resolve(frame.result)
            }
          }
          return
        }

        // Pong (ignore)
        if (frame.type === 'pong') return

        // Event — forward to renderer
        if (frame.type === 'event' && frame.channel && PROXIED_EVENTS.has(frame.channel)) {
          for (const win of this.getWindows()) {
            if (!win.isDestroyed()) {
              win.webContents.send(frame.channel, ...(frame.args || []))
            }
          }
          return
        }
      })

      this.ws.on('close', () => {
        clearTimeout(authTimeout)
        const wasConnected = this._connected
        this._connected = false

        // Reject all pending invokes
        for (const [id, pending] of this.pending) {
          clearTimeout(pending.timer)
          pending.reject(new Error('Connection closed'))
          this.pending.delete(id)
        }

        if (wasConnected) {
          logger.log('[RemoteClient] Disconnected')
        }

        // Auto-reconnect if we should
        if (this.shouldReconnect && wasConnected) {
          this.scheduleReconnect()
        }
      })

      this.ws.on('error', (err) => {
        logger.error('[RemoteClient] WebSocket error:', err.message)
        if (!authResolved) {
          clearTimeout(authTimeout)
          authResolved = true
          this._connected = false
          resolve(false)
        }
      })
    })
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return
    logger.log('[RemoteClient] Reconnecting in 3 seconds...')
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null
      if (!this.shouldReconnect) return
      try {
        const ok = await this.doConnect()
        if (!ok && this.shouldReconnect) {
          this.scheduleReconnect()
        }
      } catch {
        if (this.shouldReconnect) {
          this.scheduleReconnect()
        }
      }
    }, 3000)
  }

  disconnect(): void {
    this.shouldReconnect = false
    this._connected = false

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }

    // Reject all pending
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer)
      pending.reject(new Error('Disconnected'))
      this.pending.delete(id)
    }

    if (this.ws) {
      this.ws.close()
      this.ws = null
    }

    logger.log('[RemoteClient] Disconnected')
  }

  invoke(channel: string, args: unknown[], timeout = 30000): Promise<unknown> {
    if (!this.isConnected) {
      return Promise.reject(new Error('Not connected to remote server'))
    }

    const id = this.nextId()
    const frame: RemoteFrame = { type: 'invoke', id, channel, args }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Remote invoke timeout: ${channel}`))
      }, timeout)

      this.pending.set(id, { resolve, reject, timer })
      this.ws!.send(JSON.stringify(frame))
    })
  }

  private _counter = 0
  private nextId(): string {
    return `${Date.now()}-${++this._counter}`
  }
}
