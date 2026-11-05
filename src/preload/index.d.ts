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
import type { StudentMark } from '../shared/contracts'

declare global {
  interface Window {
    signIn: {
      getRuntimeInfo(): Promise<RuntimeInfo>
      saveAppSettings(settings: AppSettings): Promise<void>
      selectSchoolLogo(): Promise<{ path: string; preview: string } | null>
      getSchoolStatus(): Promise<SchoolAuthState>
      schoolLogout(): Promise<SchoolAuthState>
      getSchoolProfile(force?: boolean): Promise<SchoolProfile>
      getSchoolClasses(): Promise<SchoolClass[]>
      getTeacherSnapshot(): Promise<TeacherSnapshot>
      startSession(
        classId: string,
        className: string,
        classSize?: number,
        departmentName?: string,
        lateAt?: string
      ): Promise<TeacherSnapshot>
      syncRoster(): Promise<TeacherSnapshot>
      setStudentMark(
        studentId: string,
        mark?: StudentMark,
        remark?: string
      ): Promise<TeacherSnapshot>
      stopSession(): Promise<TeacherSnapshot>
      markLeave(studentId: string): Promise<TeacherSnapshot>
      clearLeave(studentId: string): Promise<TeacherSnapshot>
      resetCheckin(studentId: string): Promise<TeacherSnapshot>
      resetSessionCheckins(): Promise<TeacherSnapshot>
      listArchivedSessions(query: AttendanceArchiveQuery): Promise<AttendanceArchivePage>
      getArchivedSession(sessionId: string): Promise<ArchivedSessionDetail>
      updateArchivedSession(sessionId: string, className: string): Promise<ArchivedSessionDetail>
      updateArchivedEntry(
        sessionId: string,
        studentId: string,
        update: ArchivedEntryUpdate
      ): Promise<ArchivedSessionDetail>
      deleteArchivedEntry(sessionId: string, studentId: string): Promise<ArchivedSessionDetail>
      deleteArchivedSession(sessionId: string): Promise<void>
      exportArchivedSession(sessionId: string): Promise<string | null>
      getStudentSession(): Promise<PublicSession | null>
      checkin(sessionId: string, idCard: string): Promise<CheckinResult>
      minimizeWindow(): Promise<void>
      toggleMaximizeWindow(): Promise<void>
      closeWindow(): Promise<void>
      getWindowMaximized(): Promise<boolean>
      setThemeMode(mode: ThemeMode): Promise<void>
      onWechatLoginResult(
        listener: (result: { ok: boolean; auth?: SchoolAuthState; error?: string }) => void
      ): () => void
      onWindowMaximized(listener: (maximized: boolean) => void): () => void
      onSessionStarted(listener: () => void): () => void
    }
  }
}

export {}
