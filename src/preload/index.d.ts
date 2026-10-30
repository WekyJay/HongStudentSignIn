import type {
  CheckinResult,
  PublicSession,
  RuntimeInfo,
  SchoolAuthState,
  SchoolClass,
  SchoolProfile,
  ThemeMode,
  TeacherSnapshot
} from '../shared/contracts'

declare global {
  interface Window {
    signIn: {
      getRuntimeInfo(): Promise<RuntimeInfo>
      getSchoolStatus(): Promise<SchoolAuthState>
      schoolLogout(): Promise<SchoolAuthState>
      getSchoolProfile(force?: boolean): Promise<SchoolProfile>
      getSchoolClasses(): Promise<SchoolClass[]>
      getTeacherSnapshot(): Promise<TeacherSnapshot>
      startSession(
        classId: string,
        className: string,
        classSize?: number,
        departmentName?: string
      ): Promise<TeacherSnapshot>
      stopSession(): Promise<TeacherSnapshot>
      markLeave(studentId: string): Promise<TeacherSnapshot>
      clearLeave(studentId: string): Promise<TeacherSnapshot>
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
