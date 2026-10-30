export type AppRole = 'teacher' | 'student'
export type ThemeMode = 'system' | 'light' | 'dark'

export interface AppConfig {
  role: AppRole
  stationId: string
  teacherUrl: string
  listenHost: string
  listenPort: number
  schoolName?: string
  schoolLogoPath?: string
  schoolServerUrl?: string
  wechatAppId?: string
  wechatRedirectUri?: string
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
  serverError?: string
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
}

export interface ClassRoster {
  students: SessionStudent[]
  /** 学校接口返回但缺少学号、姓名或身份证号，无法参与核对的记录数 */
  skipped: number
  /** 分页拉取时重复出现的同一学号，已合并的人数 */
  duplicates: number
}

export type AttendanceStatus = 'signed' | 'absent' | 'leave'

export interface RosterEntry {
  studentId: string
  studentName: string
  gender?: number
  attendance: AttendanceStatus
  signedAt?: string
  stationId?: string
  idCardLast4?: string
}

export interface PublicSession {
  id: string
  classId: string
  className: string
  /** 班级所属学部/部门，来自学校班级列表，可能为空 */
  departmentName?: string
  startedAt: string
  active: boolean
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
