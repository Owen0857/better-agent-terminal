import { networkInterfaces } from 'os'
import { logger } from '../logger'

export type TunnelMode = 'tailscale' | 'lan'

export interface NetworkAddress {
  ip: string
  mode: TunnelMode
  label: string  // e.g. "en0 (Tailscale)" or "en0 (LAN)"
}

export interface TunnelResult {
  url: string
  token: string
  mode: TunnelMode
  addresses: NetworkAddress[]
}

/**
 * List all available IPv4 addresses and build a connection URL.
 * Tailscale IPs (100.x.x.x) are listed first.
 */
export function getConnectionInfo(port: number, token: string): TunnelResult | { error: string } {
  const addresses = getAllAddresses()
  if (addresses.length === 0) {
    return { error: 'No network interface found' }
  }

  // Default to first address (Tailscale first, then LAN)
  const primary = addresses[0]
  const url = `ws://${primary.ip}:${port}`
  logger.log(`[TunnelManager] Primary: ${url} (${primary.label}), ${addresses.length} addresses available`)
  return { url, token, mode: primary.mode, addresses }
}

function getAllAddresses(): NetworkAddress[] {
  const nets = networkInterfaces()
  const tailscale: NetworkAddress[] = []
  const lan: NetworkAddress[] = []

  for (const [name, iface] of Object.entries(nets)) {
    if (!iface) continue
    for (const net of iface) {
      if (net.family !== 'IPv4' || net.internal) continue
      if (net.address.startsWith('100.')) {
        tailscale.push({ ip: net.address, mode: 'tailscale', label: `${name} — ${net.address} (Tailscale)` })
      } else {
        lan.push({ ip: net.address, mode: 'lan', label: `${name} — ${net.address} (LAN)` })
      }
    }
  }

  // Tailscale first
  return [...tailscale, ...lan]
}
