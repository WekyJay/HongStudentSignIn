import type { CheckinResult, PublicSession, RuntimeInfo } from '../../../shared/contracts'

interface PublicRuntimeInfo {
  schoolName?: string
  schoolLogoDataUrl?: string | null
}

function hasElectronBridge(): boolean {
  return typeof window !== 'undefined' && typeof window.signIn !== 'undefined'
}

function getBrowserStationId(): string {
  const key = 'hong-sign-in-browser-station-id'
  try {
    const saved = localStorage.getItem(key)
    if (saved) return saved
    const stationId = `browser-${crypto.randomUUID()}`
    localStorage.setItem(key, stationId)
    return stationId
  } catch {
    return `browser-${Date.now()}-${Math.random().toString(36).slice(2)}`
  }
}

async function readJson<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as T & { message?: string }
  if (!response.ok && !payload) throw new Error(`HTTP ${response.status}`)
  return payload
}

export async function getStudentRuntimeInfo(): Promise<RuntimeInfo> {
  if (hasElectronBridge()) return window.signIn.getRuntimeInfo()

  const response = await fetch('/api/v1/runtime', { cache: 'no-store' })
  const branding = await readJson<PublicRuntimeInfo>(response)
  const schoolName = branding.schoolName?.trim() || '学校名称'
  return {
    role: 'student',
    schoolName,
    schoolLogoDataUrl: branding.schoolLogoDataUrl ?? null,
    stationId: getBrowserStationId(),
    teacherUrl: window.location.origin,
    schoolServerUrl: '',
    wechatAppId: '',
    wechatRedirectUri: '',
    configPath: '',
    appSettings: {
      schoolName,
      schoolLogoPath: '',
      schoolServerUrl: '',
      wechatAppId: '',
      wechatRedirectUri: '',
      listenPort: Number(new URL(window.location.href).port) || 41731,
      closeAfterCheckin: true
    }
  }
}

export async function getStudentSession(): Promise<PublicSession | null> {
  if (hasElectronBridge()) return window.signIn.getStudentSession()

  const response = await fetch('/api/v1/session', { cache: 'no-store' })
  return (await readJson<{ session: PublicSession | null }>(response)).session
}

export async function submitStudentCheckin(
  sessionId: string,
  idCard: string
): Promise<CheckinResult> {
  if (hasElectronBridge()) return window.signIn.checkin(sessionId, idCard)

  const response = await fetch('/api/v1/checkins', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId, idCard, stationId: getBrowserStationId() })
  })
  return readJson<CheckinResult>(response)
}

export function onStudentSessionStarted(listener: () => void): () => void {
  return hasElectronBridge() ? window.signIn.onSessionStarted(listener) : () => undefined
}
