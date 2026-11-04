import { createSocket } from 'node:dgram'
import { networkInterfaces } from 'node:os'
import type { AppConfig } from '../shared/contracts'

const DISCOVERY_PORT = 41732
const DISCOVERY_KIND = 'hong-student-sign-in-discovery-v1'

function ipv4Number(address: string): number | null {
  const parts = address.split('.').map(Number)
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return null
  }
  return parts.reduce((value, part) => (value * 256 + part) >>> 0, 0)
}

function broadcastAddress(address: string, netmask: string): string | null {
  const ipParts = address.split('.').map(Number)
  const maskParts = netmask.split('.').map(Number)
  if (ipParts.length !== 4 || maskParts.length !== 4) return null
  if (ipParts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null
  if (maskParts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null
  return ipParts.map((part, index) => (part | (~maskParts[index] & 255)).toString()).join('.')
}

/** Teacher replies to a small LAN broadcast with its private-network address. */
export async function startTeacherDiscovery(config: AppConfig): Promise<() => Promise<void>> {
  const socket = createSocket({ type: 'udp4', reuseAddr: true })
  socket.on('message', (message, remote) => {
    try {
      const request = JSON.parse(message.toString()) as { kind?: string }
      if (request.kind !== DISCOVERY_KIND) return
      const interfaces = Object.values(networkInterfaces()).flatMap((addresses) =>
        (addresses ?? []).filter((address) => address.family === 'IPv4' && !address.internal)
      )
      const remoteIp = ipv4Number(remote.address)
      const matchingInterface = interfaces.find((address) => {
        const ip = ipv4Number(address.address)
        const mask = ipv4Number(address.netmask)
        return ip !== null && mask !== null && remoteIp !== null && (ip & mask) === (remoteIp & mask)
      })
      const localInterface = matchingInterface ?? interfaces[0]
      if (!localInterface) return
      const url = config.teacherUrl.startsWith('https://')
        ? config.teacherUrl
        : `http://${localInterface.address}:${config.listenPort}`
      socket.send(
        Buffer.from(JSON.stringify({ kind: DISCOVERY_KIND, teacherUrl: url })),
        remote.port,
        remote.address
      )
    } catch {
      // Ignore unrelated or malformed LAN broadcast packets.
    }
  })
  await new Promise<void>((resolve, reject) => {
    socket.once('error', reject)
    socket.bind(DISCOVERY_PORT, '0.0.0.0', () => {
      socket.off('error', reject)
      resolve()
    })
  })
  return () =>
    new Promise<void>((resolve) => {
      socket.close(() => resolve())
    })
}

export function getTeacherLanUrl(config: AppConfig): string {
  if (config.teacherUrl.startsWith('https://')) return config.teacherUrl
  const interfaces = Object.entries(networkInterfaces()).flatMap(([name, addresses]) =>
    (addresses ?? [])
      .filter((address) => address.family === 'IPv4' && !address.internal)
      .map((address) => ({ name, address }))
  )
  const localInterface =
    interfaces.find(
      ({ name, address }) =>
        isPrivateLanIpv4(address.address) &&
        !/vmware|vethernet|virtual|tailscale|docker|loopback|wsl|hyper-v|vpn|tunnel|tap/i.test(name)
    ) ?? interfaces.find(({ address }) => isPrivateLanIpv4(address.address)) ?? interfaces[0]
  return localInterface
    ? `http://${localInterface.address.address}:${config.listenPort}`
    : config.teacherUrl
}

function isPrivateLanIpv4(address: string): boolean {
  const ip = ipv4Number(address)
  if (ip === null) return false
  const first = (ip >>> 24) & 255
  const second = (ip >>> 16) & 255
  return (
    first === 10 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 100 && second >= 64 && second <= 127)
  )
}

/** Finds and verifies a teacher service without a per-student config edit. */
export async function discoverTeacherUrl(): Promise<string> {
  const socket = createSocket('udp4')
  const request = Buffer.from(JSON.stringify({ kind: DISCOVERY_KIND }))
  const broadcasts = new Set(['255.255.255.255'])
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === 'IPv4' && !address.internal) {
        const broadcast = broadcastAddress(address.address, address.netmask)
        if (broadcast) broadcasts.add(broadcast)
      }
    }
  }

  return new Promise<string>((resolve, reject) => {
    let finished = false
    const finish = (url?: string, error?: Error): void => {
      if (finished) return
      finished = true
      clearTimeout(timeout)
      socket.close()
      if (url) resolve(url)
      else reject(error ?? new Error('未发现教师端，请确认教师端已启动且两台电脑连接同一局域网'))
    }

    const timeout = setTimeout(() => finish(), 1800)
    socket.on('error', (error) => finish(undefined, error))
    socket.on('message', async (message) => {
      try {
        const response = JSON.parse(message.toString()) as { kind?: string; teacherUrl?: string }
        if (response.kind !== DISCOVERY_KIND || !response.teacherUrl) return
        const url = new URL(response.teacherUrl)
        if (
          url.protocol !== 'https:' &&
          (url.protocol !== 'http:' || !isPrivateLanIpv4(url.hostname))
        ) {
          return
        }
        const health = await fetch(new URL('/health', url), { signal: AbortSignal.timeout(1500) })
        if (!health.ok) return
        const body = (await health.json()) as { status?: string }
        if (body.status === 'ok') finish(url.toString().replace(/\/$/, ''))
      } catch {
        // Ignore invalid advertisements and continue listening for another teacher.
      }
    })
    socket.bind(0, () => {
      try {
        socket.setBroadcast(true)
        for (const broadcast of broadcasts) {
          socket.send(request, DISCOVERY_PORT, broadcast)
        }
      } catch (error) {
        finish(undefined, error as Error)
      }
    })
  })
}
