export type AppRole = 'teacher' | 'student'
export type ThemeMode = 'system' | 'light' | 'dark'

export interface AppConfig {
  role: AppRole
  stationId: string
  /** 学生端留空时通过局域网自动发现教师端 */
  teacherUrl: string
  listenHost: string
  listenPort: number
  schoolName?: string
  schoolLogoPath?: string
  schoolServerUrl?: string
  wechatAppId?: string
  wechatRedirectUri?: string
  /** 单个终端签到成功后是否收起签到窗口，旧配置默认开启 */
  closeAfterCheckin?: boolean
  tls?: { certPath: string; keyPath: string }
}

export interface RuntimeInfo {
  role: AppRole
  schoolName: string
  schoolLogoDataUrl: string | null
  stationId: string
  teacherUrl: string
  schoolServerUrl: string
  wechatAppId: string
  wechatRedirectUri: string
  configPath: string
  appSettings: AppSettings
  serverError?: string
}

export interface AppSettings {
  schoolName: string
  schoolLogoPath: string
  schoolServerUrl: string
  wechatAppId: string
  wechatRedirectUri: string
  listenPort: number
  closeAfterCheckin: boolean
}

export interface SchoolAuthState {
  loggedIn: boolean
  userId: number | null
  serverUrl: string
}

export interface SchoolProfile {
  id: number | null
  /** 登录账号名 */
  userName: string
  /** 展示名称：优先员工姓名，其次账号名 */
  displayName: string
  /** 头像数据地址（主进程已抓取为 data URL），无头像时为 null */
  avatarUrl: string | null
  phoneNumber?: string
  empId?: number | null
  roleNames: string[]
}

export interface SchoolClass {
  id: string
  className: string
  departmentName?: string
  advisorName?: string
  size?: number
}

export interface SessionStudent {
  studentId: string
  studentName: string
  idCard: string
  gender?: number
  avatarUrl?: string | null
}

export interface ClassRoster {
  students: SessionStudent[]
  /** 学校接口返回但缺少学号、姓名或身份证号，无法参与核对的记录数 */
  skipped: number
  /** 分页拉取时重复出现的同一学号，已合并的人数 */
  duplicates: number
}

export type AttendanceStatus = 'signed' | 'late' | 'absent' | 'leave'
export type StudentMark = 'leave' | 'withdrawn' | 'other'

export interface RosterEntry {
  studentId: string
  studentName: string
  gender?: number
  avatarUrl?: string | null
  attendance: AttendanceStatus
  signedAt?: string
  stationId?: string
  idCardLast4?: string
  /** 仅教师端当前名单可见，不经学生端接口发送 */
  idCard?: string
  mark?: StudentMark
  remark?: string
}

export interface PublicSession {
  id: string
  classId: string
  className: string
  schoolName?: string
  /** 班级所属学部/部门，来自学校班级列表，可能为空 */
  departmentName?: string
  startedAt: string
  active: boolean
  lateAt?: string
}

export interface CheckinRecord {
  sessionId: string
  studentId: string
  studentName: string
  stationId: string
  signedAt: string
  idCardLast4: string
}

export interface TeacherSnapshot {
  session: PublicSession | null
  checkins: CheckinRecord[]
  roster: RosterEntry[] | null
  /** 名单与学校数据不一致时的提示（人数不符、记录缺失等），null 表示完整 */
  rosterNotice: string | null
  directoryReady: boolean
}

export interface ConnectedTerminal {
  stationId: string
  lastSeenAt: string
  screenCapturedAt?: string
  screenDataUrl?: string
}

export interface AttendanceArchiveQuery {
  from?: string
  to?: string
  keyword?: string
  page?: number
}

export interface ArchivedSession {
  id: string
  classId: string
  className: string
  departmentName?: string
  startedAt: string
  endedAt: string
  lateAt?: string
  total: number
  signed: number
  leave: number
  absent: number
  late: number
  rosterNotice: string | null
}

export interface ArchivedEntry extends RosterEntry {
  sessionId: string
}

export interface ArchivedSessionDetail {
  session: ArchivedSession
  entries: ArchivedEntry[]
}

export interface AttendanceArchivePage {
  items: ArchivedSession[]
  total: number
  page: number
  pageSize: number
}

export interface ArchivedEntryUpdate {
  attendance: AttendanceStatus
  signedAt?: string
  stationId?: string
  mark?: StudentMark
  remark?: string
}

export interface CheckinRequest {
  sessionId: string
  idCard: string
  stationId: string
}

export type CheckinCode =
  | 'SUCCESS'
  | 'INVALID_ID_CARD'
  | 'NO_ACTIVE_SESSION'
  | 'SESSION_CHANGED'
  | 'DIRECTORY_UNAVAILABLE'
  | 'NOT_IN_CLASS'
  | 'ALREADY_SIGNED'
  | 'ON_LEAVE'
  | 'NETWORK_ERROR'

export interface CheckinResult {
  code: CheckinCode
  message: string
  studentName?: string
  /** 签到成功时回传，供学生端当场核对本人信息 */
  className?: string
  departmentName?: string
  signedAt?: string
  stationId?: string
}
