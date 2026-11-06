import type { ConnectedTerminal, TerminalScreenFrame } from '../shared/contracts'

const ONLINE_TTL_MS = 15_000

interface TerminalState extends ConnectedTerminal {
  screenDataUrl?: string
}

export class TerminalRegistry {
  private readonly terminals = new Map<string, TerminalState>()

  update(report: {
    stationId: string
    screenDataUrl?: string
    screenThumbnailDataUrl?: string
    appVersion?: string
    clientType?: 'desktop' | 'browser'
  }): void {
    const now = new Date().toISOString()
    const previous = this.terminals.get(report.stationId)
    const recentScreen =
      previous?.screenCapturedAt && Date.parse(previous.screenCapturedAt) >= Date.now() - 20_000
        ? previous
        : undefined
    const hasNewCapture = Boolean(report.screenDataUrl || report.screenThumbnailDataUrl)
    this.terminals.set(report.stationId, {
      stationId: report.stationId,
      lastSeenAt: now,
      screenCapturedAt:
        report.screenDataUrl || report.screenThumbnailDataUrl
          ? now
          : recentScreen?.screenCapturedAt,
      screenDataUrl:
        report.screenDataUrl ?? (hasNewCapture ? undefined : recentScreen?.screenDataUrl),
      screenThumbnailDataUrl:
        report.screenThumbnailDataUrl ??
        report.screenDataUrl ??
        recentScreen?.screenThumbnailDataUrl ??
        recentScreen?.screenDataUrl,
      appVersion: report.appVersion ?? previous?.appVersion,
      clientType: report.clientType ?? previous?.clientType
    })
  }

  list(): ConnectedTerminal[] {
    const cutoff = Date.now() - ONLINE_TTL_MS
    for (const [stationId, terminal] of this.terminals) {
      if (Date.parse(terminal.lastSeenAt) < cutoff) this.terminals.delete(stationId)
    }
    return [...this.terminals.values()]
      .map(({ screenDataUrl: _screenDataUrl, ...terminal }) => terminal)
      .sort((a, b) => a.stationId.localeCompare(b.stationId, 'zh-CN'))
  }

  getScreen(stationId: string): TerminalScreenFrame | null {
    const terminal = this.terminals.get(stationId)
    if (!terminal?.screenDataUrl || !terminal.screenCapturedAt) return null
    return { capturedAt: terminal.screenCapturedAt, dataUrl: terminal.screenDataUrl }
  }
}
