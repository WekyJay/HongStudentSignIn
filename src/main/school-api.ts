import { safeStorage } from 'electron'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import type { ClassRoster, SchoolClass, SchoolProfile, SessionStudent } from '../shared/contracts'

interface Result<T> {
  code: number
  msg: string
  data: T
}

interface LoginData {
  token: string
  refreshToken: string
  userId: number
}

interface ClassRecord {
  id: number | string
  className?: string
  departmentName?: string
  advisorName?: string
  size?: number
}

interface StudentRecord {
  id: number | string
  name?: string
  idCard?: string
  gender?: number
  avatar?: string
}

interface StudentPage {
  records?: StudentRecord[]
  total?: number
  pages?: number
}

interface StoredAuth {
  userId: number
  refreshToken: string
  encrypted: boolean
}

interface RoleRecord {
  name?: string
  alias?: string
}

interface UserInfoRecord {
  id?: number | string
  userName?: string
  empName?: string
  avatar?: string
  phoneNumber?: string
  empId?: number | string
  roleList?: RoleRecord[]
}

const PAGE_LIMIT = 200
const ACCESS_TOKEN_REFRESH_WINDOW_MS = 60_000
const MAX_AVATAR_BYTES = 2 * 1024 * 1024
const AVATAR_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

function normalizeId(value: number | string | undefined): number | null {
  if (value === undefined || value === null || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function imageTypeFromUrl(url: URL): string | null {
  const path = url.pathname.toLowerCase()
  if (path.endsWith('.png')) return 'image/png'
  if (path.endsWith('.jpg') || path.endsWith('.jpeg')) return 'image/jpeg'
  if (path.endsWith('.webp')) return 'image/webp'
  if (path.endsWith('.gif')) return 'image/gif'
  return null
}

// Follows HongSchoolUniapp/common/utils/imageTools.js: process OSS avatars
// with the same thumbnail styles (xs for list rows, xl for the preview).
function processStudentAvatarUrl(url: string, size: 'thumbnail' | 'preview'): string {
  if (!url || !url.includes('oss.zzch.cn') || url.startsWith('data:')) return url
  if (url.includes('x-oss-process=')) return url
  const suffix = size === 'thumbnail' ? 'x64' : 'x1024'
  return `${url}${url.includes('?') ? '&' : '?'}x-oss-process=style/thumbnail${suffix}`
}

export class SchoolApiClient {
  private token: string | null = null
  private refreshToken: string | null = null
  private userId: number | null = null
  private refreshing: Promise<boolean> | null = null
  private profile: SchoolProfile | null = null

  constructor(
    private readonly baseUrl: string,
    private readonly authPath: string,
    private readonly avatarCachePath: string
  ) {}

  get loggedIn(): boolean {
    return this.token !== null || this.refreshToken !== null
  }

  get currentUserId(): number | null {
    return this.userId
  }

  async restore(): Promise<boolean> {
    let stored: StoredAuth
    try {
      stored = JSON.parse(await readFile(this.authPath, 'utf8')) as StoredAuth
    } catch {
      return false
    }
    try {
      const refreshToken = stored.encrypted
        ? safeStorage.decryptString(Buffer.from(stored.refreshToken, 'base64'))
        : stored.refreshToken
      this.refreshToken = refreshToken
      this.userId = stored.userId
      return await this.refresh()
    } catch {
      await this.clear()
      return false
    }
  }

  async logout(): Promise<void> {
    if (this.token) {
      await this.rawRequest('/user/logout', { method: 'DELETE' }).catch(() => undefined)
    }
    await this.clear()
  }

  async loginWithWechat(code: string, state: string): Promise<void> {
    const response = await this.rawRequest(
      `/wechat/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`
    )
    const body = (await response.json()) as Result<LoginData>
    if (body.code === 404) {
      throw new Error('该微信还未绑定学校账号，请先在系统中完成账号绑定')
    }
    if (body.code !== 200 || !body.data?.token) {
      throw new Error(body.msg || '微信扫码登录失败，请重试')
    }
    this.token = body.data.token
    this.refreshToken = body.data.refreshToken
    this.userId = body.data.userId
    this.profile = null
    await this.persist()
  }

  async getProfile(force = false): Promise<SchoolProfile> {
    if (this.profile && !force) return this.profile
    const raw = await this.request<UserInfoRecord>('/user/info')
    const userName = raw.userName?.trim() ?? ''
    const profile: SchoolProfile = {
      id: normalizeId(raw.id),
      userName,
      displayName: raw.empName?.trim() || userName || '学校用户',
      avatarUrl: await this.loadAvatar(raw.avatar),
      phoneNumber: raw.phoneNumber?.trim() || undefined,
      empId: normalizeId(raw.empId),
      roleNames: (raw.roleList ?? [])
        .map((role) => (role.alias || role.name || '').trim())
        .filter(Boolean)
    }
    this.profile = profile
    return profile
  }

  // 头像在渲染进程里直接加载会被 CSP 拦截，也可能需要携带登录态；
  // 因此由主进程取回并转成 data URL。
  private async loadAvatar(value: string | undefined): Promise<string | null> {
    const avatar = value?.trim()
    if (!avatar) return null
    if (avatar.startsWith('data:image/')) {
      return avatar.length <= MAX_AVATAR_BYTES ? avatar : null
    }
    let url: URL
    try {
      url = new URL(avatar, this.resolve('/'))
    } catch {
      return null
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 5000)
    try {
      const headers: Record<string, string> = {}
      if (this.token && url.origin === new URL(this.baseUrl).origin) {
        headers['authorization'] = `Bearer ${this.token}`
      }
      // OSS hotlink protection rejects requests without Referer. Keep this
      // aligned with HongSchoolUniapp's imageTools guidance for oss.zzch.cn.
      if (url.hostname === 'oss.zzch.cn') headers['referer'] = 'https://hxy.zzch.cn/'
      const response = await fetch(url, { headers, signal: controller.signal })
      if (!response.ok) return null
      const buffer = Buffer.from(await response.arrayBuffer())
      if (buffer.length === 0 || buffer.length > MAX_AVATAR_BYTES) return null
      const contentType = (response.headers.get('content-type') ?? '')
        .split(';')[0]
        .trim()
        .toLowerCase()
      const type = AVATAR_TYPES.has(contentType) ? contentType : imageTypeFromUrl(url)
      if (!type) return null
      return `data:${type};base64,${buffer.toString('base64')}`
    } catch {
      return null
    } finally {
      clearTimeout(timer)
    }
  }

  async getClasses(): Promise<SchoolClass[]> {
    const data = await this.request<ClassRecord[] | { records?: ClassRecord[] }>(
      '/classes?isGraduated=0'
    )
    const records = Array.isArray(data) ? data : (data.records ?? [])
    return records
      .filter((item) => item.className)
      .map((item) => ({
        id: String(item.id),
        className: item.className!,
        departmentName: item.departmentName,
        advisorName: item.advisorName,
        size: item.size
      }))
  }

  async getStudents(classId: string): Promise<ClassRoster> {
    // 用学号建索引：翻页过程中学校数据变动可能重复返回同一学生，
    // 重复项不能重复计入名单，否则应到人数和签到核对都会被算错。
    const students = new Map<string, SessionStudent>()
    let skipped = 0
    let duplicates = 0
    let page = 1
    for (;;) {
      const data = await this.request<StudentPage>(
        `/student?classId=${encodeURIComponent(classId)}&page=${page}&limit=${PAGE_LIMIT}`
      )
      const records = data.records ?? []
      for (const record of records) {
        if (record.id == null || !record.name || !record.idCard) {
          skipped += 1
          continue
        }
        if (record.idCard.includes('*')) {
          throw new Error('学校账号权限不足，身份证号被脱敏，请使用管理员账号登录')
        }
        const studentId = String(record.id)
        if (students.has(studentId)) {
          duplicates += 1
          continue
        }
        students.set(studentId, {
          studentId,
          studentName: record.name,
          idCard: record.idCard.toUpperCase(),
          gender: record.gender,
          avatarUrl: record.avatar?.trim() || null
        })
      }
      const pages = data.pages ?? 1
      if (page >= pages || records.length === 0) break
      page += 1
    }
    return { students: [...students.values()], skipped, duplicates }
  }

  async getStudentAvatar(avatarUrl: string, size: 'thumbnail' | 'preview'): Promise<string | null> {
    const source = avatarUrl.trim()
    if (!source) return null
    let resolvedSource = source
    if (!source.startsWith('data:image/')) {
      try {
        resolvedSource = new URL(source, this.resolve('/')).toString()
      } catch {
        return null
      }
    }
    const imageUrl = processStudentAvatarUrl(resolvedSource, size)
    const cacheKey = createHash('sha256').update(`${size}:${imageUrl}`).digest('hex')
    const cacheFile = join(this.avatarCachePath, `${cacheKey}.data`)
    try {
      return await readFile(cacheFile, 'utf8')
    } catch {
      // Cache miss; fetch and save below.
    }
    const loaded = await this.loadAvatar(imageUrl)
    if (!loaded) return null
    try {
      await mkdir(this.avatarCachePath, { recursive: true })
      await writeFile(cacheFile, loaded, 'utf8')
    } catch {
      // A cache write failure should not hide an otherwise usable image.
    }
    return loaded
  }

  private resolve(path: string): URL {
    const base = this.baseUrl.endsWith('/') ? this.baseUrl : `${this.baseUrl}/`
    return new URL(path.replace(/^\/+/, ''), base)
  }

  private async request<T>(path: string, init: RequestInit = {}, retried = false): Promise<T> {
    if (!retried && this.shouldRefreshAccessToken()) {
      // Renew shortly before expiry so an idle teacher window does not wait
      // for a protected request to fail before recovering its session.
      await this.refresh()
    }
    const response = await this.rawRequest(path, init)
    if (response.status === 401) {
      if (retried || !(await this.refresh())) throw new Error('登录已失效，请重新登录')
      return this.request<T>(path, init, true)
    }
    const body = (await response.json()) as Result<T>
    if (body.code === 401) {
      if (retried || !(await this.refresh())) throw new Error(body.msg || '登录已失效，请重新登录')
      return this.request<T>(path, init, true)
    }
    if (body.code !== 200) throw new Error(body.msg || `学校服务返回错误（${body.code}）`)
    return body.data
  }

  private shouldRefreshAccessToken(): boolean {
    if (!this.token) return false
    try {
      const payload = this.token.split('.')[1]
      if (!payload) return false
      const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
        exp?: unknown
      }
      return (
        typeof claims.exp === 'number' &&
        claims.exp * 1000 - Date.now() <= ACCESS_TOKEN_REFRESH_WINDOW_MS
      )
    } catch {
      return false
    }
  }

  private async rawRequest(path: string, init: RequestInit = {}): Promise<Response> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 8000)
    try {
      const headers: Record<string, string> = {
        'content-type': 'application/json',
        ...(init.headers as Record<string, string>)
      }
      if (this.token) headers['authorization'] = `Bearer ${this.token}`
      return await fetch(this.resolve(path), {
        ...init,
        headers,
        signal: controller.signal
      })
    } catch (error) {
      if ((error as Error).name === 'AbortError')
        throw new Error('学校服务连接超时', { cause: error })
      throw new Error('无法连接学校服务，请检查网络或服务地址', { cause: error })
    } finally {
      clearTimeout(timer)
    }
  }

  private refresh(): Promise<boolean> {
    this.refreshing ??= this.doRefresh().finally(() => {
      this.refreshing = null
    })
    return this.refreshing
  }

  private async doRefresh(): Promise<boolean> {
    if (!this.refreshToken) return false
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 8000)
      const response = await fetch(this.resolve('/user/refresh'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken: this.refreshToken }),
        signal: controller.signal
      }).finally(() => clearTimeout(timer))
      if (response.status === 401) {
        await this.clear()
        return false
      }
      if (!response.ok) return false
      const body = (await response.json()) as Result<LoginData>
      if (body.code === 401) {
        await this.clear()
        return false
      }
      if (body.code !== 200 || !body.data?.token) return false
      this.token = body.data.token
      this.refreshToken = body.data.refreshToken
      this.userId = body.data.userId
      await this.persist()
      return true
    } catch {
      return false
    }
  }

  private async persist(): Promise<void> {
    if (!this.refreshToken || this.userId === null) return
    const encrypted = safeStorage.isEncryptionAvailable()
    const stored: StoredAuth = {
      userId: this.userId,
      refreshToken: encrypted
        ? safeStorage.encryptString(this.refreshToken).toString('base64')
        : this.refreshToken,
      encrypted
    }
    await mkdir(dirname(this.authPath), { recursive: true })
    await writeFile(this.authPath, JSON.stringify(stored), 'utf8')
  }

  private async clear(): Promise<void> {
    this.token = null
    this.refreshToken = null
    this.userId = null
    this.profile = null
    await rm(this.authPath, { force: true })
  }
}
