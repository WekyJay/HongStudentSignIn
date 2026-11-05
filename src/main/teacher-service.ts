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
import type { StudentMark } from '../shared/contracts'
import type { StudentDirectory } from './directory'
import { AttendanceArchive } from './attendance-archive'
import { isValidMainlandIdCard } from './identity'
import { isLate } from './attendance-time'

interface PersistedState {
  session: PublicSession | null
  checkins: CheckinRecord[]
  roster: SessionStudent[] | null
  leave: string[]
  marks?: Record<string, { mark: StudentMark; remark?: string }>
  rosterNotice: string | null
  archivedSessionId?: string
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
    marks: {},
    rosterNotice: null
  }
  private pending = Promise.resolve()

  constructor(
    private readonly path: string,
    private readonly directory: StudentDirectory,
    private readonly archive: AttendanceArchive
  ) {}

  async load(): Promise<void> {
    try {
      const persisted = JSON.parse(await readFile(this.path, 'utf8')) as Partial<PersistedState>
      this.state = {
        session: persisted.session ?? null,
        checkins: persisted.checkins ?? [],
        roster: persisted.roster ?? null,
        leave: persisted.leave ?? [],
        marks:
          persisted.marks ??
          Object.fromEntries((persisted.leave ?? []).map((id) => [id, { mark: 'leave' }])),
        rosterNotice: persisted.rosterNotice ?? null,
        archivedSessionId: persisted.archivedSessionId
      }
      // 将旧版本状态文件里最后一个已结束场次补入历史库，仅迁移一次。
      if (
        this.state.session &&
        !this.state.session.active &&
        this.state.archivedSessionId !== this.state.session.id
      ) {
        this.archive.archive(
          this.state.session,
          this.snapshot().roster ?? [],
          this.state.rosterNotice
        )
        this.clearCurrentSession()
        await this.save()
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
          const mark = this.state.marks?.[student.studentId]
          const onLeave = mark?.mark === 'leave' || this.state.leave.includes(student.studentId)
          const late = Boolean(record && isLate(record.signedAt, this.state.session?.lateAt))
          return {
            studentId: student.studentId,
            studentName: student.studentName,
            gender: student.gender,
            attendance: record ? (late ? 'late' : 'signed') : onLeave ? 'leave' : 'absent',
            signedAt: record?.signedAt,
            stationId: record?.stationId,
            idCardLast4: record?.idCardLast4 ?? student.idCard.slice(-4),
            idCard: student.idCard,
            mark: mark?.mark,
            remark: mark?.remark
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

  hasCheckinAtStation(sessionId: string, stationId: string): boolean {
    return this.state.checkins.some(
      (record) => record.sessionId === sessionId && record.stationId === stationId
    )
  }

  async listClasses(): Promise<SchoolClass[]> {
    if (!this.directory.ready) throw new Error('请先登录学校服务')
    return this.directory.listClasses()
  }

  async startSession(
    classId: string,
    className: string,
    expectedSize?: number,
    departmentName?: string,
    lateAt?: string
  ): Promise<TeacherSnapshot> {
    if (!classId.trim() || !className.trim()) throw new Error('请选择要签到的班级')
    if (this.state.session?.active) throw new Error('请先结束当前场次')
    if (!this.directory.ready) throw new Error('请先登录学校服务再开启签到')
    const { students, skipped, duplicates } = await this.directory.fetchClassRoster(classId.trim())
    if (this.state.session?.active) throw new Error('请先结束当前场次')
    if (students.length === 0) throw new Error('该班级没有学生，无法开启签到')
    this.state = {
      session: {
        id: randomUUID(),
        classId: classId.trim(),
        className: className.trim(),
        departmentName: departmentName?.trim() || undefined,
        startedAt: new Date().toISOString(),
        active: true,
        lateAt
      },
      checkins: [],
      roster: students,
      leave: [],
      marks: {},
      rosterNotice: rosterNotice(students.length, expectedSize, skipped, duplicates),
      archivedSessionId: undefined
    }
    await this.save()
    return this.snapshot()
  }

  async stopSession(): Promise<TeacherSnapshot> {
    if (!this.state.session?.active) return this.snapshot()
    this.archive.archive(this.state.session, this.snapshot().roster ?? [], this.state.rosterNotice)
    this.clearCurrentSession()
    await this.save()
    return this.snapshot()
  }

  private clearCurrentSession(): void {
    this.state = {
      session: null,
      checkins: [],
      roster: null,
      leave: [],
      marks: {},
      rosterNotice: null,
      archivedSessionId: this.state.session?.id
    }
  }

  async markLeave(studentId: string): Promise<TeacherSnapshot> {
    if (!this.state.session?.active) throw new Error('当前没有进行中的签到场次')
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
      this.state.marks ??= {}
      this.state.marks[studentId] = { mark: 'leave' }
      await this.save()
    }
    return this.snapshot()
  }

  async clearLeave(studentId: string): Promise<TeacherSnapshot> {
    if (!this.state.session?.active) throw new Error('当前没有进行中的签到场次')
    const next = this.state.leave.filter((id) => id !== studentId)
    if (next.length !== this.state.leave.length) {
      this.state.leave = next
      if (this.state.marks?.[studentId]?.mark === 'leave') delete this.state.marks[studentId]
      await this.save()
    }
    return this.snapshot()
  }

  async setMark(studentId: string, mark?: StudentMark, remark?: string): Promise<TeacherSnapshot> {
    if (!this.state.session?.active) throw new Error('当前没有进行中的签到场次')
    if (!this.state.roster?.some((student) => student.studentId === studentId))
      throw new Error('学生不在当前名单中')
    if (remark && remark.trim().length > 100) throw new Error('备注不能超过 100 字')
    if (mark === 'other' && !remark?.trim()) throw new Error('请填写其它情况')
    if (mark === 'leave' && this.state.checkins.some((record) => record.studentId === studentId))
      throw new Error('已签到的学生不能标记请假')
    this.state.marks ??= {}
    if (mark) this.state.marks[studentId] = { mark, remark: remark?.trim() || undefined }
    else delete this.state.marks[studentId]
    this.state.leave = this.state.leave.filter((id) => id !== studentId)
    if (mark === 'leave') this.state.leave.push(studentId)
    await this.save()
    return this.snapshot()
  }

  async syncRoster(): Promise<TeacherSnapshot> {
    const session = this.state.session
    if (!session?.active) throw new Error('当前没有进行中的签到场次')
    if (!this.directory.ready) throw new Error('学校服务尚未连接')
    const { students, skipped, duplicates } = await this.directory.fetchClassRoster(session.classId)
    if (this.state.session?.id !== session.id) throw new Error('签到场次已变化')
    const existing = new Map(
      (this.state.roster ?? []).map((student) => [student.studentId, student])
    )
    // 保留已签到或已标记的旧名单成员，避免同步后丢失本场记录。
    const next = new Map(students.map((student) => [student.studentId, student]))
    for (const [id, student] of existing) {
      if (
        !next.has(id) &&
        (this.state.checkins.some((record) => record.studentId === id) || this.state.marks?.[id])
      )
        next.set(id, student)
    }
    this.state.roster = [...next.values()]
    this.state.rosterNotice = rosterNotice(students.length, undefined, skipped, duplicates)
    await this.save()
    return this.snapshot()
  }

  /** 清除单个学生在本场的签到记录，学生可在学生端重新签到 */
  async resetCheckin(studentId: string): Promise<TeacherSnapshot> {
    if (!this.state.session?.active) throw new Error('当前没有进行中的签到场次')
    if (!this.state.roster?.some((student) => student.studentId === studentId)) {
      throw new Error('该学生不在当前班级名单中')
    }
    const sessionId = this.state.session.id
    const next = this.state.checkins.filter(
      (record) => !(record.sessionId === sessionId && record.studentId === studentId)
    )
    if (next.length === this.state.checkins.length) throw new Error('该学生尚未签到，无需重新签到')
    this.state.checkins = next
    await this.save()
    return this.snapshot()
  }

  /** 清除全班在本场的签到记录（请假标记保留），学生可重新签到 */
  async resetSessionCheckins(): Promise<TeacherSnapshot> {
    if (!this.state.session?.active) throw new Error('当前没有进行中的签到场次')
    const sessionId = this.state.session.id
    const next = this.state.checkins.filter((record) => record.sessionId !== sessionId)
    if (next.length === this.state.checkins.length) throw new Error('本场还没有签到记录')
    this.state.checkins = next
    await this.save()
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
      message: isLate(record.signedAt, session.lateAt) ? '签到成功，已标记迟到' : '签到成功',
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
