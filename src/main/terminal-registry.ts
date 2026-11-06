import type { ConnectedTerminal } from '../shared/contracts'

const ONLINE_TTL_MS = 15_000

export class TerminalRegistry {
  private readonly terminals = new Map<string, ConnectedTerminal>()

  update(stationId: string, screenDataUrl?: string): void {
    const now = new Date().toISOString()
    const previous = this.terminals.get(stationId)
    this.terminals.set(stationId, {
      stationId,
      lastSeenAt: now,
      screenCapturedAt: screenDataUrl ? now : previous?.screenCapturedAt,
      screenDataUrl: screenDataUrl ?? previous?.screenDataUrl
    })
  }

  list(): ConnectedTerminal[] {
    const cutoff = Date.now() - ONLINE_TTL_MS
    for (const [stationId, terminal] of this.terminals) {
      if (Date.parse(terminal.lastSeenAt) < cutoff) this.terminals.delete(stationId)
    }
    return [...this.terminals.values()].sort((a, b) => a.stationId.localeCompare(b.stationId, 'zh-CN'))
  }
}
