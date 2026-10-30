import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type {
  CheckinRecord,
  CheckinRequest,
  CheckinResult,
  PublicSession,
  RosterEntry,
  SchoolClass,
  SessionStudent,
  TeacherSnapshot
} from '../shared/contracts'
import type { StudentDirectory } from './directory'
import { isValidMainlandIdCard } from './identity'

interface PersistedState {
  session: PublicSession | null
  checkins: CheckinRecord[]
  roster: SessionStudent[] | null
  leave: string[]
  rosterNotice: string | null
}

// 名单是签到核对的基础：人数不符或记录缺失时明确提示，避免出现“应到人数”被悄悄算错。
function rosterNotice(
  rosterSize: number,
  expectedSize: number | undefined,
  skipped: number,
  duplicates: number
): string | null {
  const issues: string[] = []
  if (
    typeof expectedSize === 'number' &&
    Number.isFinite(expectedSize) &&
    expectedSize > 0 &&
    expectedSize !== rosterSize
  ) {
    issues.push(`班级登记 ${expectedSize} 人，实际拉取到 ${rosterSize} 名学生`)
  }
  if (skipped > 0) issues.push(`${skipped} 条学生记录缺少学号、姓名或身份证号，已跳过`)
  if (duplicates > 0) issues.push(`${duplicates} 条重复学生记录已按学号合并`)
  return issues.length ? `${issues.join('；')}，请核对名单` : null
}

export class TeacherService {
  private state: PersistedState = {
    session: null,
    checkins: [],
    roster: null,
    leave: [],
    rosterNotice: null
  }
  private pending = Promise.resolve()

  constructor(
    private readonly path: string,
    private readonly directory: StudentDirectory
  ) {}

  async load(): Promise<void> {
    try {
      const persisted = JSON.parse(await readFile(this.path, 'utf8')) as Partial<PersistedState>
      this.state = {
        session: persisted.session ?? null,
        checkins: persisted.checkins ?? [],
        roster: persisted.roster ?? null,
        leave: persisted.leave ?? [],
        rosterNotice: persisted.rosterNotice ?? null
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }

  snapshot(): TeacherSnapshot {
    const sessionId = this.state.session?.id
    const checkins = this.state.checkins.filter((record) => record.sessionId === sessionId)
    const roster = this.state.roster
      ? this.state.roster.map((student): RosterEntry => {
          const record = checkins.find((item) => item.studentId === student.studentId)
          const onLeave = this.state.leave.includes(student.studentId)
          return {
            studentId: student.studentId,
            studentName: student.studentName,
            gender: student.gender,
            attendance: record ? 'signed' : onLeave ? 'leave' : 'absent',
            signedAt: record?.signedAt,
            stationId: record?.stationId,
            idCardLast4: record?.idCardLast4 ?? student.idCard.slice(-4)
          }
        })
      : null
    return {
      session: this.state.session,
      checkins,
      roster,
      rosterNotice: this.state.rosterNotice,
      directoryReady: this.directory.ready
    }
  }

  publicSession(): PublicSession | null {
    return this.state.session
  }

  async listClasses(): Promise<SchoolClass[]> {
    if (!this.directory.ready) throw new Error('请先登录学校服务')
    return this.directory.listClasses()
  }

  async startSession(
    classId: string,
    className: string,
    expectedSize?: number,
    departmentName?: string
  ): Promise<TeacherSnapshot> {
    if (!classId.trim() || !className.trim()) throw new Error('请选择要签到的班级')
    if (!this.directory.ready) throw new Error('请先登录学校服务再开启签到')
    const { students, skipped, duplicates } = await this.directory.fetchClassRoster(classId.trim())
    if (students.length === 0) throw new Error('该班级没有学生，无法开启签到')
    this.state = {
      session: {
        id: randomUUID(),
        classId: classId.trim(),
        className: className.trim(),
        departmentName: departmentName?.trim() || undefined,
        startedAt: new Date().toISOString(),
        active: true
      },
      checkins: this.state.checkins,
      roster: students,
      leave: [],
      rosterNotice: rosterNotice(students.length, expectedSize, skipped, duplicates)
    }
    await this.save()
    return this.snapshot()
  }

  async stopSession(): Promise<TeacherSnapshot> {
    if (this.state.session) this.state.session = { ...this.state.session, active: false }
    await this.save()
    return this.snapshot()
  }

  async markLeave(studentId: string): Promise<TeacherSnapshot> {
    if (!this.state.roster?.some((student) => student.studentId === studentId)) {
      throw new Error('该学生不在当前班级名单中')
    }
    if (
      this.state.checkins.some(
        (record) => record.sessionId === this.state.session?.id && record.studentId === studentId
      )
    ) {
      throw new Error('该学生已签到，不能标记请假')
    }
    if (!this.state.leave.includes(studentId)) {
      this.state.leave.push(studentId)
      await this.save()
    }
    return this.snapshot()
  }

  async clearLeave(studentId: string): Promise<TeacherSnapshot> {
    const next = this.state.leave.filter((id) => id !== studentId)
    if (next.length !== this.state.leave.length) {
      this.state.leave = next
      await this.save()
    }
    return this.snapshot()
  }

  async checkin(request: CheckinRequest): Promise<CheckinResult> {
    const idCard = request.idCard.trim().toUpperCase()
    if (!isValidMainlandIdCard(idCard))
      return { code: 'INVALID_ID_CARD', message: '身份证号码格式或校验位不正确' }
    const session = this.state.session
    if (!session?.active) return { code: 'NO_ACTIVE_SESSION', message: '教师尚未开启签到' }
    if (request.sessionId !== session.id)
      return { code: 'SESSION_CHANGED', message: '签到场次已更新，请刷新页面' }
    const roster = this.state.roster
    if (!roster) return { code: 'DIRECTORY_UNAVAILABLE', message: '学生名单尚未加载，暂不能签到' }

    const student = roster.find((item) => item.idCard === idCard)
    if (!student) {
      return { code: 'NOT_IN_CLASS', message: '此身份证不在当前班级名单中' }
    }
    if (this.state.leave.includes(student.studentId)) {
      return { code: 'ON_LEAVE', message: '该学生已请假，如需签到请联系教师取消请假' }
    }
    if (
      this.state.checkins.some(
        (record) => record.sessionId === session.id && record.studentId === student.studentId
      )
    ) {
      return { code: 'ALREADY_SIGNED', message: '该学生已签到' }
    }
    const record: CheckinRecord = {
      sessionId: session.id,
      studentId: student.studentId,
      studentName: student.studentName,
      stationId: request.stationId,
      signedAt: new Date().toISOString(),
      idCardLast4: idCard.slice(-4)
    }
    this.state.checkins.push(record)
    await this.save()
    return {
      code: 'SUCCESS',
      message: '签到成功',
      studentName: student.studentName,
      className: session.className,
      departmentName: session.departmentName,
      signedAt: record.signedAt,
      stationId: record.stationId
    }
  }

  private async save(): Promise<void> {
    const data = JSON.stringify(this.state, null, 2)
    this.pending = this.pending.then(async () => {
      await mkdir(dirname(this.path), { recursive: true })
      const temporary = `${this.path}.tmp`
      await writeFile(temporary, data, 'utf8')
      await rename(temporary, this.path)
    })
    await this.pending
  }
}
