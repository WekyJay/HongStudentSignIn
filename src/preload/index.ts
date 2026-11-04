import { contextBridge, ipcRenderer } from 'electron'
import type {
  ArchivedEntryUpdate,
  ArchivedSessionDetail,
  AttendanceArchivePage,
  AttendanceArchiveQuery,
  CheckinResult,
  AppSettings,
  PublicSession,
  RuntimeInfo,
  SchoolAuthState,
  SchoolClass,
  SchoolProfile,
  ThemeMode,
  TeacherSnapshot
} from '../shared/contracts'

const api = {
  getRuntimeInfo: (): Promise<RuntimeInfo> => ipcRenderer.invoke('runtime:info'),
  saveAppSettings: (settings: AppSettings): Promise<void> =>
    ipcRenderer.invoke('settings:save', settings),
  selectSchoolLogo: (): Promise<{ path: string; preview: string } | null> =>
    ipcRenderer.invoke('settings:select-logo'),
  getSchoolStatus: (): Promise<SchoolAuthState> => ipcRenderer.invoke('school:status'),
  schoolLogout: (): Promise<SchoolAuthState> => ipcRenderer.invoke('school:logout'),
  getSchoolProfile: (force = false): Promise<SchoolProfile> =>
    ipcRenderer.invoke('school:profile', force),
  getSchoolClasses: (): Promise<SchoolClass[]> => ipcRenderer.invoke('school:classes'),
  getTeacherSnapshot: (): Promise<TeacherSnapshot> => ipcRenderer.invoke('teacher:snapshot'),
  startSession: (
    classId: string,
    className: string,
    classSize?: number,
    departmentName?: string
  ): Promise<TeacherSnapshot> =>
    ipcRenderer.invoke('teacher:start', classId, className, classSize, departmentName),
  stopSession: (): Promise<TeacherSnapshot> => ipcRenderer.invoke('teacher:stop'),
  markLeave: (studentId: string): Promise<TeacherSnapshot> =>
    ipcRenderer.invoke('teacher:mark-leave', studentId),
  clearLeave: (studentId: string): Promise<TeacherSnapshot> =>
    ipcRenderer.invoke('teacher:clear-leave', studentId),
  resetCheckin: (studentId: string): Promise<TeacherSnapshot> =>
    ipcRenderer.invoke('teacher:reset-checkin', studentId),
  resetSessionCheckins: (): Promise<TeacherSnapshot> =>
    ipcRenderer.invoke('teacher:reset-session-checkins'),
  listArchivedSessions: (query: AttendanceArchiveQuery): Promise<AttendanceArchivePage> =>
    ipcRenderer.invoke('archive:list', query),
  getArchivedSession: (sessionId: string): Promise<ArchivedSessionDetail> =>
    ipcRenderer.invoke('archive:get', sessionId),
  updateArchivedSession: (sessionId: string, className: string): Promise<ArchivedSessionDetail> =>
    ipcRenderer.invoke('archive:update-session', sessionId, className),
  updateArchivedEntry: (
    sessionId: string,
    studentId: string,
    update: ArchivedEntryUpdate
  ): Promise<ArchivedSessionDetail> =>
    ipcRenderer.invoke('archive:update-entry', sessionId, studentId, update),
  deleteArchivedEntry: (sessionId: string, studentId: string): Promise<ArchivedSessionDetail> =>
    ipcRenderer.invoke('archive:delete-entry', sessionId, studentId),
  deleteArchivedSession: (sessionId: string): Promise<void> =>
    ipcRenderer.invoke('archive:delete-session', sessionId),
  exportArchivedSession: (sessionId: string): Promise<string | null> =>
    ipcRenderer.invoke('archive:export', sessionId),
  getStudentSession: (): Promise<PublicSession | null> => ipcRenderer.invoke('student:session'),
  checkin: (sessionId: string, idCard: string): Promise<CheckinResult> =>
    ipcRenderer.invoke('student:checkin', sessionId, idCard),
  minimizeWindow: (): Promise<void> => ipcRenderer.invoke('window:minimize'),
  toggleMaximizeWindow: (): Promise<void> => ipcRenderer.invoke('window:toggle-maximize'),
  closeWindow: (): Promise<void> => ipcRenderer.invoke('window:close'),
  getWindowMaximized: (): Promise<boolean> => ipcRenderer.invoke('window:get-maximized'),
  setThemeMode: (mode: ThemeMode): Promise<void> => ipcRenderer.invoke('theme:set', mode),
  onWechatLoginResult: (
    listener: (result: { ok: boolean; auth?: SchoolAuthState; error?: string }) => void
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      result: { ok: boolean; auth?: SchoolAuthState; error?: string }
    ): void => listener(result)
    ipcRenderer.on('school:wechat-result', handler)
    return () => ipcRenderer.removeListener('school:wechat-result', handler)
  },
  onWindowMaximized: (listener: (maximized: boolean) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, maximized: boolean): void =>
      listener(maximized)
    ipcRenderer.on('window:maximized', handler)
    return () => ipcRenderer.removeListener('window:maximized', handler)
  },
  // 主进程检测到教师开场次时通知渲染进程立即刷新，避免 kiosk 弹出后还停留在等待页
  onSessionStarted: (listener: () => void): (() => void) => {
    const handler = (): void => listener()
    ipcRenderer.on('student:session-started', handler)
    return () => ipcRenderer.removeListener('student:session-started', handler)
  }
}

contextBridge.exposeInMainWorld('signIn', api)
