import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  screen,
  Tray
} from 'electron'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { hostname } from 'node:os'
import { extname, join } from 'node:path'
import type { NativeImage } from 'electron'
import { is } from '@electron-toolkit/utils'
import type {
  AppConfig,
  AppSettings,
  ArchivedEntryUpdate,
  AttendanceArchiveQuery,
  CheckinResult,
  PublicSession,
  RuntimeInfo,
  SchoolAuthState,
  SchoolProfile,
  ThemeMode
} from '../shared/contracts'
import { applyUserDataDir, loadConfig, resolveBuildRole } from './config'
import { SchoolServerDirectory } from './directory'
import { startTeacherServer } from './http-server'
import { discoverTeacherUrl, getTeacherLanUrl, startTeacherDiscovery } from './teacher-discovery'
import { SchoolApiClient } from './school-api'
import { TeacherService } from './teacher-service'
import { AttendanceArchive } from './attendance-archive'
import { exportAttendanceExcel } from './attendance-export'

// 教师端、学生端分开打包时，由安装包内的 signinRole 决定默认角色与用户数据目录
const buildRole = resolveBuildRole()
applyUserDataDir(buildRole)

const uiPreview = is.dev && process.env.SIGNIN_UI_PREVIEW === '1'

function loadImageDataUrl(path: string): string | null {
  const mimeTypes: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif'
  }
  const mimeType = mimeTypes[extname(path).toLowerCase()]
  if (!mimeType) return null
  try {
    const image = readFileSync(path)
    if (image.length === 0 || image.length > 2 * 1024 * 1024) return null
    return `data:${mimeType};base64,${image.toString('base64')}`
  } catch {
    return null
  }
}

function loadSchoolLogo(path: string | undefined): string | null {
  const customLogo = path ? loadImageDataUrl(path) : null
  return customLogo ?? loadImageDataUrl(join(__dirname, '../../resources/school-logo.png'))
}

function applicationIconPath(): string {
  return applicationIconPathForSchoolLogo(undefined)
}

function applicationIconPathForSchoolLogo(schoolLogoPath: string | undefined): string {
  if (schoolLogoPath && existsSync(schoolLogoPath)) return schoolLogoPath
  const generatedIconPath = join(__dirname, '../../resources/icon.png')
  return existsSync(generatedIconPath)
    ? generatedIconPath
    : join(__dirname, '../../resources/default-icon.png')
}

let activeAppIconPath = applicationIconPath()

// 学生端驻留托盘时再次双击快捷方式只唤起已有进程，不重复开托盘图标
const singleInstance = app.requestSingleInstanceLock()
if (!singleInstance) app.quit()

let mainWindow: BrowserWindow | null = null
let allowStudentClose = false
let studentSessionActive = false
// 教师端关闭窗口只隐藏到托盘，只有托盘「退出程序」才真正结束进程
let teacherQuitting = false

// 学生端常驻托盘：灰色=未连接教师端，彩色=已连接；签到进行中时禁止从托盘退出
let studentTray: Tray | null = null
let studentTrayKey = ''
let teacherTray: Tray | null = null

// 微信扫码回调由主进程统一处理（will-navigate 处理顶层跳转，webRequest 处理 iframe 内跳转）
let wechatCallbackHandler: ((url: string) => void) | null = null
let lastWechatCallbackUrl = ''
let discoveredTeacherUrl: string | undefined

function handleWechatCallback(url: string): void {
  if (url === lastWechatCallbackUrl) return
  lastWechatCallbackUrl = url
  wechatCallbackHandler?.(url)
}

function windowBackground(): string {
  return nativeTheme.shouldUseDarkColors ? '#18191b' : '#f7f9fc'
}

function createWindow(config: AppConfig, teacherAuthenticated: boolean): BrowserWindow {
  // 学生端正常运行时静默驻留托盘，等教师开启场次后再弹出 kiosk
  const studentKiosk = config.role === 'student' && !uiPreview
  const teacherSetupComplete = Boolean(
    config.schoolServerUrl && config.wechatAppId && config.wechatRedirectUri
  )
  const compactTeacherWindow = !teacherSetupComplete || !teacherAuthenticated
  const teacherHeight = Math.min(
    teacherSetupComplete ? 760 : 860,
    Math.max(600, screen.getPrimaryDisplay().workAreaSize.height - 32)
  )
  const window = new BrowserWindow({
    width: config.role === 'teacher' ? (compactTeacherWindow ? 820 : 1100) : 850,
    height: config.role === 'teacher' ? teacherHeight : 760,
    minWidth: 700,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    frame: false,
    icon: activeAppIconPath,
    backgroundColor: windowBackground(),
    fullscreen: config.role === 'student',
    kiosk: studentKiosk,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      // 隐藏到托盘时渲染进程仍需按秒轮询场次状态
      backgroundThrottling: !studentKiosk,
      devTools: is.dev
    }
  })
  window.on('close', (event) => {
    if (studentKiosk && !allowStudentClose) {
      event.preventDefault()
      return
    }
    // 教师端点关闭只隐藏到托盘，不影响教师机上正在运行的签到服务
    if (config.role === 'teacher' && !teacherQuitting) {
      event.preventDefault()
      window.hide()
      console.info('[teacher-tray] window hidden to tray')
    }
  })
  if (!studentKiosk) window.once('ready-to-show', () => window.show())
  if (studentKiosk) {
    window.on('show', () => console.info('[student-kiosk] window shown'))
    window.on('hide', () => console.info('[student-kiosk] window hidden'))
  }
  window.on('blur', () => {
    if (studentKiosk && studentSessionActive) window.focus()
  })
  window.on('minimize', () => {
    if (studentKiosk && studentSessionActive) window.restore()
  })
  window.on('maximize', () => window.webContents.send('window:maximized', true))
  window.on('unmaximize', () => window.webContents.send('window:maximized', false))
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => {
    // 微信扫码回调交给主进程换 token，其余跳转一律禁止
    if (config.wechatRedirectUri && event.url.startsWith(config.wechatRedirectUri)) {
      event.preventDefault()
      handleWechatCallback(event.url)
      return
    }
    event.preventDefault()
  })
  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return window
}

async function fetchTeacher<T>(config: AppConfig, path: string, init?: RequestInit): Promise<T> {
  const teacherUrl = config.teacherUrl || (discoveredTeacherUrl ??= await discoverTeacherUrl())
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8000)
  try {
    const response = await fetch(new URL(path, teacherUrl), {
      ...init,
      signal: controller.signal
    })
    return (await response.json()) as T
  } catch (error) {
    if (!config.teacherUrl) discoveredTeacherUrl = undefined
    throw error
  } finally {
    clearTimeout(timer)
  }
}

type StudentTrayState = 'offline' | 'idle' | 'active'

function trayImage(gray: boolean): NativeImage {
  const image = nativeImage.createFromPath(activeAppIconPath)
  if (image.isEmpty()) return image
  // 32px 托盘图标在高分屏下不会被放糊，Windows 会按 DPI 缩放
  const sized = image.resize({ width: 32, height: 32 })
  if (!gray) return sized
  // nativeImage 没有灰度 API，这里直接处理 BGRA 位图
  const { width, height } = sized.getSize()
  const bitmap = sized.toBitmap()
  for (let i = 0; i < bitmap.length; i += 4) {
    const value = Math.round(0.299 * bitmap[i + 2] + 0.587 * bitmap[i + 1] + 0.114 * bitmap[i])
    bitmap[i] = value
    bitmap[i + 1] = value
    bitmap[i + 2] = value
  }
  return nativeImage.createFromBitmap(bitmap, { width, height })
}

function updateStudentTray(state: StudentTrayState, className?: string): void {
  if (!studentTray) return
  const tooltip =
    state === 'active'
      ? `机房签到学生端 · 签到进行中${className ? `：${className}` : ''}`
      : state === 'idle'
        ? '机房签到学生端 · 已连接，等待签到场次'
        : '机房签到学生端 · 未连接教师端'
  if (tooltip === studentTrayKey) return
  studentTrayKey = tooltip
  studentTray.setImage(trayImage(state === 'offline'))
  studentTray.setToolTip(tooltip)
  // 不提供任何退出入口，学生无法从托盘结束程序
  console.info('[student-tray]', tooltip)
}

function createStudentTray(): void {
  if (studentTray) return
  studentTray = new Tray(trayImage(true))
  studentTray.on('double-click', () => {
    if (studentSessionActive && mainWindow && !mainWindow.isVisible()) {
      mainWindow.show()
      mainWindow.focus()
    }
  })
  updateStudentTray('offline')
}

function showMainWindow(): void {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
  console.info('[tray] main window shown')
}

function createTeacherTray(): void {
  if (teacherTray) return
  teacherTray = new Tray(trayImage(false))
  teacherTray.setToolTip('机房签到教师端')
  teacherTray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '显示主界面', click: showMainWindow },
      { type: 'separator' },
      {
        label: '退出程序',
        click: () => {
          teacherQuitting = true
          app.quit()
        }
      }
    ])
  )
  teacherTray.on('click', showMainWindow)
  teacherTray.on('double-click', showMainWindow)
  console.info('[teacher-tray] ready')
}

function setStudentWindowActive(active: boolean): void {
  const window = mainWindow
  if (!window) return
  if (active) {
    window.setKiosk(true)
    window.setAlwaysOnTop(true, 'screen-saver')
    if (!window.isVisible()) {
      // 开机自启时页面可能还没加载完，等首屏渲染后再显示，避免白屏闪烁
      if (window.webContents.isLoading()) {
        window.webContents.once('did-finish-load', () => window.show())
      } else {
        window.show()
      }
    }
    // 让渲染进程立即拉一次场次，kiosk 弹出时已经在签到页
    window.webContents.send('student:session-started')
    window.focus()
  } else {
    window.setAlwaysOnTop(false)
    if (window.isVisible()) window.hide()
  }
}

function startStudentSessionMonitor(config: AppConfig): void {
  const poll = async (): Promise<void> => {
    try {
      const data = await fetchTeacher<{ session: PublicSession | null }>(config, '/api/v1/session')
      const session = data.session
      const active = Boolean(session?.active)
      if (active !== studentSessionActive || (active && !mainWindow?.isVisible())) {
        studentSessionActive = active
        setStudentWindowActive(active)
      }
      updateStudentTray(active ? 'active' : 'idle', session?.className)
    } catch {
      // 教师机断线时保持当前画面不变，避免学生借断网退出 kiosk
      updateStudentTray('offline')
    } finally {
      setTimeout(() => void poll(), 3000)
    }
  }
  void poll()
}

function configureAutoStart(): void {
  if (!app.isPackaged) return
  // 自动化测试或调试传入独立数据目录时不写开机启动项
  if (process.argv.some((arg) => arg.startsWith('--user-data-dir'))) return
  app.setLoginItemSettings({ openAtLogin: true, path: process.execPath, args: [] })
}

app.whenReady().then(async () => {
  if (!singleInstance) return
  try {
    const { config, path: configPath } = loadConfig(buildRole)
    activeAppIconPath = applicationIconPathForSchoolLogo(config.schoolLogoPath)
    const schoolApi = new SchoolApiClient(
      config.schoolServerUrl!,
      join(app.getPath('userData'), 'school-auth.json')
    )
    let service: TeacherService | null = null
    let attendanceArchive: AttendanceArchive | null = null
    let serverError: string | undefined
    let stopServer: (() => Promise<void>) | undefined
    let stopDiscovery: (() => Promise<void>) | undefined
    if (config.role === 'teacher') {
      if (config.schoolServerUrl) await schoolApi.restore()
      attendanceArchive = new AttendanceArchive(join(app.getPath('userData'), 'attendance.sqlite'))
      service = new TeacherService(
        join(app.getPath('userData'), 'teacher-state.json'),
        new SchoolServerDirectory(schoolApi),
        attendanceArchive
      )
      await service.load()
      try {
        stopServer = await startTeacherServer(config, service)
        stopDiscovery = await startTeacherDiscovery(config)
      } catch (error) {
        serverError = (error as Error).message
      }
    }
    const schoolAuthState = (): SchoolAuthState => ({
      loggedIn: schoolApi.loggedIn,
      userId: schoolApi.currentUserId,
      serverUrl: config.schoolServerUrl || ''
    })

    mainWindow = createWindow(config, schoolApi.loggedIn)
    if (config.role === 'student' && !uiPreview) {
      // 学生端静默驻留托盘：灰色=连不上教师端，等教师开场次后自动弹出 kiosk
      createStudentTray()
      startStudentSessionMonitor(config)
      console.info('[student-kiosk] tray resident, waiting for session')
    } else if (config.role === 'teacher') {
      // 教师端关闭窗口后留在托盘，签到服务继续运行
      createTeacherTray()
    }
    configureAutoStart()
    nativeTheme.on('updated', () => mainWindow?.setBackgroundColor(windowBackground()))

    // 微信扫码登录：二维码确认后微信会跳转到回调地址并携带 code，
    // 拦截该跳转（iframe 内跳转走 webRequest，顶层跳转走 will-navigate），
    // 用 code 向学校后端换取登录 token。
    wechatCallbackHandler = (url) => {
      const callbackUrl = new URL(url)
      const code = callbackUrl.searchParams.get('code')
      const state = callbackUrl.searchParams.get('state') ?? 'pc'
      void (async () => {
        try {
          if (!code) throw new Error('微信回调缺少授权码')
          await schoolApi.loginWithWechat(code, state)
          if (mainWindow && !mainWindow.isMaximized()) {
            mainWindow.setSize(1100, 760)
            mainWindow.center()
          }
          mainWindow?.webContents.send('school:wechat-result', {
            ok: true,
            auth: schoolAuthState()
          })
        } catch (error) {
          mainWindow?.webContents.send('school:wechat-result', {
            ok: false,
            error: (error as Error).message
          })
        }
      })()
    }
    if (config.wechatRedirectUri) {
      const callbackFilter = { urls: [`${config.wechatRedirectUri}*`] }
      mainWindow.webContents.session.webRequest.onBeforeRequest(callbackFilter, (details, done) => {
        done({ cancel: true })
        handleWechatCallback(details.url)
      })
    }
    // 兜底：万一 webRequest 未拦截到 iframe 跳转，导航完成后同样取 code 换 token
    mainWindow.webContents.on('did-frame-navigate', (_event, url) => {
      if (config.wechatRedirectUri && url.startsWith(config.wechatRedirectUri)) {
        handleWechatCallback(url)
      }
    })
    const permitted = (senderId: number, role?: AppConfig['role']): boolean =>
      senderId === mainWindow?.webContents.id && (!role || config.role === role)

    ipcMain.handle('window:minimize', (event) => {
      if (!permitted(event.sender.id, 'teacher')) throw new Error('无权访问')
      mainWindow?.minimize()
    })
    ipcMain.handle('window:toggle-maximize', (event) => {
      if (!permitted(event.sender.id, 'teacher')) throw new Error('无权访问')
      if (mainWindow?.isMaximized()) mainWindow.unmaximize()
      else mainWindow?.maximize()
    })
    ipcMain.handle('window:close', (event) => {
      if (!permitted(event.sender.id, 'teacher')) throw new Error('无权访问')
      mainWindow?.close()
    })
    ipcMain.handle('window:get-maximized', (event): boolean => {
      if (!permitted(event.sender.id, 'teacher')) throw new Error('无权访问')
      return mainWindow?.isMaximized() ?? false
    })

    ipcMain.handle('theme:set', (event, mode: unknown) => {
      if (!permitted(event.sender.id)) throw new Error('无权访问')
      if (mode !== 'system' && mode !== 'light' && mode !== 'dark') {
        throw new Error('主题模式无效')
      }
      nativeTheme.themeSource = mode as ThemeMode
      mainWindow?.setBackgroundColor(windowBackground())
    })

    ipcMain.handle('runtime:info', (event): RuntimeInfo => {
      if (!permitted(event.sender.id)) throw new Error('无权访问')
      return {
        role: config.role,
        schoolName: config.schoolName || '学校名称',
        schoolLogoDataUrl: loadSchoolLogo(config.schoolLogoPath),
        appSettings: {
          schoolName: config.schoolName || '学校名称',
          schoolLogoPath: config.schoolLogoPath || '',
          schoolServerUrl: config.schoolServerUrl || '',
          wechatAppId: config.wechatAppId || '',
          wechatRedirectUri: config.wechatRedirectUri || '',
          listenPort: config.listenPort
        },
        stationId: hostname(),
        teacherUrl: config.role === 'teacher' ? getTeacherLanUrl(config) : config.teacherUrl,
        schoolServerUrl: config.schoolServerUrl || '',
        wechatAppId: config.wechatAppId!,
        wechatRedirectUri: config.wechatRedirectUri!,
        configPath,
        serverError
      }
    })

    ipcMain.handle(
      'settings:select-logo',
      async (event): Promise<{ path: string; preview: string } | null> => {
        if (!permitted(event.sender.id, 'teacher')) throw new Error('无权访问')
        const options = {
          title: '选择学校 Logo',
          properties: ['openFile'] as Array<'openFile'>,
          filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }]
        }
        const result = mainWindow
          ? await dialog.showOpenDialog(mainWindow, options)
          : await dialog.showOpenDialog(options)
        if (result.canceled || !result.filePaths[0]) return null
        const preview = loadImageDataUrl(result.filePaths[0])
        if (!preview) {
          throw new Error('Logo 无法读取或超过 2 MiB，请选择 PNG、JPEG、WebP 或 GIF 图片')
        }
        return { path: result.filePaths[0], preview }
      }
    )

    ipcMain.handle('settings:save', (event, value: unknown): void => {
      if (!permitted(event.sender.id, 'teacher')) throw new Error('无权访问')
      if (!value || typeof value !== 'object') throw new Error('设置内容无效')
      const settings = value as Partial<AppSettings>
      const trimmed = (input: unknown): string => (typeof input === 'string' ? input.trim() : '')
      const schoolName = trimmed(settings.schoolName)
      const schoolLogoPath = trimmed(settings.schoolLogoPath)
      const schoolServerUrl = trimmed(settings.schoolServerUrl)
      const wechatAppId = trimmed(settings.wechatAppId)
      const wechatRedirectUri = trimmed(settings.wechatRedirectUri)
      const listenPort = settings.listenPort
      if (!schoolName || schoolName.length > 80)
        throw new Error('学校名称不能为空，且不能超过 80 个字符')
      if (!schoolServerUrl || !wechatAppId || !wechatRedirectUri) {
        throw new Error('请填写学校服务地址、微信 AppID 和回调地址')
      }
      if (schoolLogoPath && !loadImageDataUrl(schoolLogoPath)) {
        throw new Error('Logo 无法读取或超过 2 MiB，请重新选择图片')
      }
      for (const [label, value] of [
        ['学校服务地址', schoolServerUrl],
        ['微信回调地址', wechatRedirectUri]
      ]) {
        if (!value) continue
        let parsed: URL
        try {
          parsed = new URL(value)
        } catch {
          throw new Error(`${label}格式不正确`)
        }
        if (!['http:', 'https:'].includes(parsed.protocol))
          throw new Error(`${label}必须使用 HTTP 或 HTTPS`)
      }
      if (wechatAppId.length > 120) throw new Error('微信 AppID 不能超过 120 个字符')
      if (
        !Number.isInteger(listenPort) ||
        (listenPort as number) < 1024 ||
        (listenPort as number) > 65535
      ) {
        throw new Error('服务端口须为 1024 到 65535 之间的整数')
      }
      const next: AppConfig = {
        ...config,
        schoolName,
        schoolLogoPath,
        schoolServerUrl,
        wechatAppId,
        wechatRedirectUri,
        listenPort: listenPort as number
      }
      const temporaryPath = `${configPath}.tmp`
      writeFileSync(temporaryPath, JSON.stringify(next, null, 2), 'utf8')
      renameSync(temporaryPath, configPath)
      app.relaunch()
      setTimeout(() => app.exit(0), 250)
    })

    const requireService = (): TeacherService => {
      if (!service) throw new Error('教师服务未启用')
      return service
    }
    const requireArchive = (): AttendanceArchive => {
      if (!attendanceArchive) throw new Error('教师端历史记录未启用')
      return attendanceArchive
    }
    const archiveId = (value: unknown): string => {
      if (typeof value !== 'string' || !value.trim() || value.length > 100) {
        throw new Error('历史记录参数无效')
      }
      return value
    }

    ipcMain.handle('school:status', (event): SchoolAuthState => {
      if (!permitted(event.sender.id, 'teacher')) throw new Error('无权访问')
      return schoolAuthState()
    })
    ipcMain.handle('school:logout', async (event): Promise<SchoolAuthState> => {
      if (!permitted(event.sender.id, 'teacher')) throw new Error('无权访问')
      await schoolApi.logout()
      if (mainWindow && !mainWindow.isMaximized()) {
        mainWindow.setSize(820, 760)
        mainWindow.center()
      }
      return schoolAuthState()
    })
    ipcMain.handle('school:profile', async (event, force: unknown): Promise<SchoolProfile> => {
      if (!permitted(event.sender.id, 'teacher')) throw new Error('无权访问')
      return schoolApi.getProfile(force === true)
    })
    ipcMain.handle('school:classes', async (event) => {
      if (!permitted(event.sender.id, 'teacher')) throw new Error('无权访问')
      return requireService().listClasses()
    })
    ipcMain.handle('teacher:snapshot', (event) => {
      if (!permitted(event.sender.id, 'teacher')) throw new Error('无权访问')
      return requireService().snapshot()
    })
    ipcMain.handle(
      'teacher:start',
      async (
        event,
        classId: unknown,
        className: unknown,
        classSize: unknown,
        departmentName: unknown
      ) => {
        if (!permitted(event.sender.id, 'teacher')) throw new Error('无权访问')
        if (
          typeof classId !== 'string' ||
          typeof className !== 'string' ||
          classId.length > 100 ||
          className.length > 100
        ) {
          throw new Error('班级参数无效')
        }
        if (
          classSize != null &&
          (typeof classSize !== 'number' ||
            !Number.isInteger(classSize) ||
            classSize < 0 ||
            classSize > 10000)
        ) {
          throw new Error('班级人数无效')
        }
        if (
          departmentName != null &&
          (typeof departmentName !== 'string' || departmentName.length > 100)
        ) {
          throw new Error('班级部门参数无效')
        }
        return requireService().startSession(
          classId,
          className,
          typeof classSize === 'number' ? classSize : undefined,
          typeof departmentName === 'string' ? departmentName : undefined
        )
      }
    )
    ipcMain.handle('teacher:stop', async (event) => {
      if (!permitted(event.sender.id, 'teacher')) throw new Error('无权访问')
      return requireService().stopSession()
    })
    ipcMain.handle('teacher:mark-leave', async (event, studentId: unknown) => {
      if (!permitted(event.sender.id, 'teacher')) throw new Error('无权访问')
      if (typeof studentId !== 'string' || studentId.length > 100) throw new Error('学生参数无效')
      return requireService().markLeave(studentId)
    })
    ipcMain.handle('teacher:clear-leave', async (event, studentId: unknown) => {
      if (!permitted(event.sender.id, 'teacher')) throw new Error('无权访问')
      if (typeof studentId !== 'string' || studentId.length > 100) throw new Error('学生参数无效')
      return requireService().clearLeave(studentId)
    })
    ipcMain.handle('teacher:reset-checkin', async (event, studentId: unknown) => {
      if (!permitted(event.sender.id, 'teacher')) throw new Error('无权访问')
      if (typeof studentId !== 'string' || studentId.length > 100) throw new Error('学生参数无效')
      return requireService().resetCheckin(studentId)
    })
    ipcMain.handle('teacher:reset-session-checkins', async (event) => {
      if (!permitted(event.sender.id, 'teacher')) throw new Error('无权访问')
      return requireService().resetSessionCheckins()
    })
    ipcMain.handle('archive:list', (event, query: unknown) => {
      if (!permitted(event.sender.id, 'teacher')) throw new Error('无权访问')
      if (!query || typeof query !== 'object' || Array.isArray(query))
        throw new Error('查询条件无效')
      const value = query as AttendanceArchiveQuery
      if (
        (value.from != null && typeof value.from !== 'string') ||
        (value.to != null && typeof value.to !== 'string') ||
        (value.keyword != null && typeof value.keyword !== 'string') ||
        (value.page != null && typeof value.page !== 'number')
      )
        throw new Error('查询条件无效')
      return requireArchive().list(value)
    })
    ipcMain.handle('archive:get', (event, sessionId: unknown) => {
      if (!permitted(event.sender.id, 'teacher')) throw new Error('无权访问')
      return requireArchive().get(archiveId(sessionId))
    })
    ipcMain.handle('archive:update-session', (event, sessionId: unknown, className: unknown) => {
      if (!permitted(event.sender.id, 'teacher')) throw new Error('无权访问')
      if (typeof className !== 'string') throw new Error('班级名称无效')
      return requireArchive().updateSession(archiveId(sessionId), className)
    })
    ipcMain.handle(
      'archive:update-entry',
      (event, sessionId: unknown, studentId: unknown, update: unknown) => {
        if (!permitted(event.sender.id, 'teacher')) throw new Error('无权访问')
        if (!update || typeof update !== 'object' || Array.isArray(update))
          throw new Error('考勤修改内容无效')
        const value = update as ArchivedEntryUpdate
        if (
          typeof value.attendance !== 'string' ||
          (value.signedAt != null && typeof value.signedAt !== 'string') ||
          (value.stationId != null && typeof value.stationId !== 'string')
        )
          throw new Error('考勤修改内容无效')
        return requireArchive().updateEntry(archiveId(sessionId), archiveId(studentId), value)
      }
    )
    ipcMain.handle('archive:delete-entry', (event, sessionId: unknown, studentId: unknown) => {
      if (!permitted(event.sender.id, 'teacher')) throw new Error('无权访问')
      return requireArchive().deleteEntry(archiveId(sessionId), archiveId(studentId))
    })
    ipcMain.handle('archive:delete-session', (event, sessionId: unknown) => {
      if (!permitted(event.sender.id, 'teacher')) throw new Error('无权访问')
      requireArchive().deleteSession(archiveId(sessionId))
    })
    ipcMain.handle('archive:export', async (event, sessionId: unknown): Promise<string | null> => {
      if (!permitted(event.sender.id, 'teacher')) throw new Error('无权访问')
      const detail = requireArchive().get(archiveId(sessionId))
      const safeName = detail.session.className.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 60)
      const options = {
        title: '导出签到记录',
        defaultPath: `${safeName}-${detail.session.startedAt.slice(0, 10)}.xlsx`,
        filters: [{ name: 'Excel 工作簿', extensions: ['xlsx'] }]
      }
      const result = mainWindow
        ? await dialog.showSaveDialog(mainWindow, options)
        : await dialog.showSaveDialog(options)
      if (result.canceled || !result.filePath) return null
      await exportAttendanceExcel(detail, result.filePath)
      return result.filePath
    })
    ipcMain.handle('student:session', async (event): Promise<PublicSession | null> => {
      if (!permitted(event.sender.id, 'student')) throw new Error('无权访问')
      const data = await fetchTeacher<{ session: PublicSession | null }>(config, '/api/v1/session')
      return data.session
    })
    ipcMain.handle(
      'student:checkin',
      async (event, sessionId: unknown, idCard: unknown): Promise<CheckinResult> => {
        if (!permitted(event.sender.id, 'student')) throw new Error('无权访问')
        if (typeof sessionId !== 'string' || typeof idCard !== 'string' || idCard.length > 30) {
          throw new Error('签到参数无效')
        }
        return fetchTeacher<CheckinResult>(config, '/api/v1/checkins', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sessionId, idCard, stationId: hostname() })
        })
      }
    )
    app.on('second-instance', () => {
      // 学生端空闲时不抢屏幕，只有签到进行中才把 kiosk 重新顶到最前
      if (!mainWindow || (config.role === 'student' && !studentSessionActive)) return
      showMainWindow()
    })

    app.on('before-quit', () => {
      allowStudentClose = true
      teacherQuitting = true
      if (stopServer) void stopServer()
      if (stopDiscovery) void stopDiscovery()
      attendanceArchive?.close()
    })
  } catch (error) {
    console.error('应用启动失败', error)
    dialog.showErrorBox('启动失败', (error as Error).message)
    app.quit()
  }
})

app.on('window-all-closed', () => app.quit())
