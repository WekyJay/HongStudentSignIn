import { app } from 'electron'
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { hostname } from 'node:os'
import { join } from 'node:path'
import type { AppConfig, AppRole } from '../shared/contracts'

const USER_DATA_DIRS: Record<AppRole, string> = {
  teacher: 'hong-student-sign-in',
  student: 'hong-student-sign-in-student'
}

/** 打包时 electron-builder 会把 signinRole 写进应用内的 package.json，决定首次启动的默认角色 */
export function resolveBuildRole(): AppRole {
  if (!app.isPackaged) return 'teacher'
  try {
    const meta = JSON.parse(readFileSync(join(app.getAppPath(), 'package.json'), 'utf8')) as {
      signinRole?: string
    }
    return meta.signinRole === 'student' ? 'student' : 'teacher'
  } catch {
    return 'teacher'
  }
}

/** 教师端、学生端分别使用独立的用户数据目录，避免同一台机器安装两个应用时配置互相覆盖 */
export function applyUserDataDir(role: AppRole): void {
  const customUserDataDir = process.argv.some((arg) => arg.startsWith('--user-data-dir'))
  if (app.isPackaged && !customUserDataDir) {
    const dir = join(app.getPath('appData'), USER_DATA_DIRS[role])
    mkdirSync(dir, { recursive: true })
    app.setName(USER_DATA_DIRS[role])
    app.setPath('userData', dir)
  }

  const userDataDir = app.getPath('userData')
  const sessionDataDir =
    customUserDataDir || process.platform !== 'win32' || !process.env.LOCALAPPDATA
      ? join(userDataDir, 'session-data')
      : join(process.env.LOCALAPPDATA, USER_DATA_DIRS[role], 'session-data')
  mkdirSync(sessionDataDir, { recursive: true })

  // Keep the saved theme preference when moving Chromium's local storage out of userData.
  const legacyLocalStorage = join(userDataDir, 'Local Storage')
  const migratedLocalStorage = join(sessionDataDir, 'Local Storage')
  if (!existsSync(migratedLocalStorage) && existsSync(legacyLocalStorage)) {
    try {
      cpSync(legacyLocalStorage, migratedLocalStorage, { recursive: true, force: false })
    } catch (error) {
      console.warn('[session-data] local storage migration skipped:', (error as Error).message)
    }
  }
  app.setPath('sessionData', sessionDataDir)
}

export function loadConfig(defaultRole: AppRole = 'teacher'): {
  config: AppConfig
  path: string
} {
  const localDevConfigPath = join(process.cwd(), 'config.local.json')
  const path =
    process.env.SIGNIN_CONFIG_PATH ||
    (!app.isPackaged && existsSync(localDevConfigPath)
      ? localDevConfigPath
      : join(app.getPath('userData'), 'config.json'))
  if (!existsSync(path)) {
    mkdirSync(app.getPath('userData'), { recursive: true })
    const initial: AppConfig = {
      role: defaultRole,
      stationId: hostname(),
      teacherUrl: defaultRole === 'student' ? '' : 'http://127.0.0.1:41731',
      listenHost: app.isPackaged && defaultRole === 'teacher' ? '0.0.0.0' : '127.0.0.1',
      listenPort: 41731,
      schoolName: '学校名称',
      schoolServerUrl: '',
      wechatAppId: '',
      wechatRedirectUri: ''
    }
    writeFileSync(path, JSON.stringify(initial, null, 2), 'utf8')
  }
  const config = JSON.parse(readFileSync(path, 'utf8')) as AppConfig
  if (app.isPackaged) {
    let migrated = false
    // Old student configs pointed back to the student PC instead of discovering the teacher.
    if (config.role === 'student' && config.teacherUrl === 'http://127.0.0.1:41731') {
      config.teacherUrl = ''
      migrated = true
    }
    // The old teacher default listened only on loopback, so LAN clients could not reach it.
    if (config.role === 'teacher') {
      if (['localhost', '127.0.0.1', '::1'].includes(config.listenHost)) {
        config.listenHost = '0.0.0.0'
        migrated = true
      }
      if (config.tls || config.teacherUrl.startsWith('https://')) {
        delete config.tls
        config.teacherUrl = `http://127.0.0.1:${config.listenPort}`
        migrated = true
      }
    }
    if (migrated) writeFileSync(path, JSON.stringify(config, null, 2), 'utf8')
  }
  config.schoolName = config.schoolName?.trim() || '学校名称'
  config.schoolServerUrl ??= ''
  config.wechatAppId ??= ''
  config.wechatRedirectUri ??= ''
  if (config.role !== 'teacher' && config.role !== 'student') throw new Error('config.role 无效')
  if (!config.stationId || typeof config.stationId !== 'string')
    throw new Error('config.stationId 无效')
  if (!Number.isInteger(config.listenPort) || config.listenPort < 1 || config.listenPort > 65535) {
    throw new Error('config.listenPort 无效')
  }
  if (config.teacherUrl) {
    const url = new URL(config.teacherUrl)
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('config.teacherUrl 协议无效')
  } else if (config.role !== 'student') {
    throw new Error('教师端必须配置学生端访问地址')
  }
  if (config.schoolServerUrl) {
    const schoolUrl = new URL(config.schoolServerUrl)
    if (!['http:', 'https:'].includes(schoolUrl.protocol)) {
      throw new Error('config.schoolServerUrl 协议无效')
    }
  }
  if (config.wechatRedirectUri) {
    const redirectUrl = new URL(config.wechatRedirectUri)
    if (!['http:', 'https:'].includes(redirectUrl.protocol)) {
      throw new Error('config.wechatRedirectUri 协议无效')
    }
  }
  return { config, path }
}
