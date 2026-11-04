import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type {
  ArchivedEntry,
  ArchivedEntryUpdate,
  ArchivedSession,
  ArchivedSessionDetail,
  AttendanceArchivePage,
  AttendanceArchiveQuery,
  PublicSession,
  RosterEntry
} from '../shared/contracts'

const PAGE_SIZE = 20

type SessionRow = Omit<ArchivedSession, 'total' | 'signed' | 'leave' | 'absent'> & {
  total: number
  signed: number
  leave: number
  absent: number
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00`)
  return !Number.isNaN(date.getTime()) &&
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}` === value
}

function validateQuery(query: AttendanceArchiveQuery): Required<AttendanceArchiveQuery> {
  const from = query.from?.trim() || ''
  const to = query.to?.trim() || ''
  const keyword = query.keyword?.trim() || ''
  const page = query.page ?? 1
  if ((from && !validDate(from)) || (to && !validDate(to)) || (from && to && from > to)) {
    throw new Error('查询日期无效')
  }
  if (keyword.length > 80) throw new Error('关键词不能超过 80 个字符')
  if (!Number.isInteger(page) || page < 1 || page > 100000) throw new Error('页码无效')
  return { from, to, keyword, page }
}

export class AttendanceArchive {
  private readonly db: DatabaseSync

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true })
    this.db = new DatabaseSync(path)
    this.db.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 3000;
      CREATE TABLE IF NOT EXISTS attendance_sessions (
        id TEXT PRIMARY KEY,
        class_id TEXT NOT NULL,
        class_name TEXT NOT NULL,
        department_name TEXT,
        started_at TEXT NOT NULL,
        ended_at TEXT NOT NULL,
        roster_notice TEXT
      );
      CREATE TABLE IF NOT EXISTS attendance_entries (
        session_id TEXT NOT NULL REFERENCES attendance_sessions(id) ON DELETE CASCADE,
        student_id TEXT NOT NULL,
        student_name TEXT NOT NULL,
        gender INTEGER,
        attendance TEXT NOT NULL CHECK(attendance IN ('signed', 'absent', 'leave')),
        signed_at TEXT,
        station_id TEXT,
        id_card_last4 TEXT,
        PRIMARY KEY (session_id, student_id)
      );
      CREATE INDEX IF NOT EXISTS attendance_sessions_started ON attendance_sessions(started_at DESC);
      CREATE INDEX IF NOT EXISTS attendance_entries_student ON attendance_entries(student_name);
    `)
  }

  close(): void {
    this.db.close()
  }

  hasSession(id: string): boolean {
    return Boolean(this.db.prepare('SELECT 1 FROM attendance_sessions WHERE id = ?').get(id))
  }

  archive(session: PublicSession, roster: RosterEntry[], rosterNotice: string | null): void {
    if (this.hasSession(session.id)) return
    const endedAt = new Date().toISOString()
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.db.prepare(`
        INSERT INTO attendance_sessions
          (id, class_id, class_name, department_name, started_at, ended_at, roster_notice)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(session.id, session.classId, session.className, session.departmentName ?? null,
        session.startedAt, endedAt, rosterNotice)
      const insertEntry = this.db.prepare(`
        INSERT INTO attendance_entries
          (session_id, student_id, student_name, gender, attendance, signed_at, station_id, id_card_last4)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      for (const entry of roster) {
        insertEntry.run(session.id, entry.studentId, entry.studentName, entry.gender ?? null,
          entry.attendance, entry.signedAt ?? null, entry.stationId ?? null,
          entry.idCardLast4 ?? null)
      }
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  list(query: AttendanceArchiveQuery = {}): AttendanceArchivePage {
    const { from, to, keyword, page } = validateQuery(query)
    const conditions: string[] = []
    const args: string[] = []
    if (from) {
      conditions.push("date(s.started_at, 'localtime') >= ?")
      args.push(from)
    }
    if (to) {
      conditions.push("date(s.started_at, 'localtime') <= ?")
      args.push(to)
    }
    if (keyword) {
      conditions.push(`(s.class_name LIKE ? OR s.class_id LIKE ? OR EXISTS (
        SELECT 1 FROM attendance_entries e
        WHERE e.session_id = s.id AND (e.student_name LIKE ? OR e.student_id LIKE ? OR e.station_id LIKE ?)
      ))`)
      const pattern = `%${keyword.replace(/[\\%_]/g, '\\$&')}%`
      args.push(pattern, pattern, pattern, pattern, pattern)
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
    // ESCAPE keeps %, _ and backslash in a typed keyword literal.
    const filteredWhere = where.replaceAll('LIKE ?', "LIKE ? ESCAPE '\\'")
    const count = this.db.prepare(`SELECT COUNT(*) AS total FROM attendance_sessions s ${filteredWhere}`)
      .get(...args) as { total: number }
    const rows = this.db.prepare(`
      SELECT s.id, s.class_id AS classId, s.class_name AS className,
        s.department_name AS departmentName, s.started_at AS startedAt,
        s.ended_at AS endedAt, s.roster_notice AS rosterNotice,
        COUNT(e.student_id) AS total,
        COALESCE(SUM(e.attendance = 'signed'), 0) AS signed,
        COALESCE(SUM(e.attendance = 'leave'), 0) AS leave,
        COALESCE(SUM(e.attendance = 'absent'), 0) AS absent
      FROM attendance_sessions s
      LEFT JOIN attendance_entries e ON e.session_id = s.id
      ${filteredWhere}
      GROUP BY s.id
      ORDER BY s.started_at DESC, s.id DESC
      LIMIT ? OFFSET ?
    `).all(...args, PAGE_SIZE, (page - 1) * PAGE_SIZE) as SessionRow[]
    return { items: rows.map((row) => ({ ...row })), total: count.total, page, pageSize: PAGE_SIZE }
  }

  get(id: string): ArchivedSessionDetail {
    const session = this.db.prepare(`
      SELECT s.id, s.class_id AS classId, s.class_name AS className,
        s.department_name AS departmentName, s.started_at AS startedAt,
        s.ended_at AS endedAt, s.roster_notice AS rosterNotice,
        COUNT(e.student_id) AS total,
        COALESCE(SUM(e.attendance = 'signed'), 0) AS signed,
        COALESCE(SUM(e.attendance = 'leave'), 0) AS leave,
        COALESCE(SUM(e.attendance = 'absent'), 0) AS absent
      FROM attendance_sessions s
      LEFT JOIN attendance_entries e ON e.session_id = s.id
      WHERE s.id = ? GROUP BY s.id
    `).get(id) as SessionRow | undefined
    if (!session) throw new Error('该历史场次不存在或已删除')
    const entries = this.db.prepare(`
      SELECT session_id AS sessionId, student_id AS studentId,
        student_name AS studentName, gender, attendance,
        signed_at AS signedAt, station_id AS stationId,
        id_card_last4 AS idCardLast4
      FROM attendance_entries WHERE session_id = ? ORDER BY student_id
    `).all(id) as unknown as ArchivedEntry[]
    return { session: { ...session }, entries: entries.map((entry) => ({ ...entry })) }
  }

  updateSession(id: string, className: string): ArchivedSessionDetail {
    const name = className.trim()
    if (!name || name.length > 100) throw new Error('班级名称须为 1 到 100 个字符')
    const result = this.db.prepare('UPDATE attendance_sessions SET class_name = ? WHERE id = ?')
      .run(name, id)
    if (!result.changes) throw new Error('该历史场次不存在或已删除')
    return this.get(id)
  }

  updateEntry(sessionId: string, studentId: string, update: ArchivedEntryUpdate): ArchivedSessionDetail {
    if (!['signed', 'absent', 'leave'].includes(update.attendance)) throw new Error('考勤状态无效')
    let signedAt: string | null = null
    let stationId: string | null = null
    if (update.attendance === 'signed') {
      signedAt = update.signedAt?.trim() || null
      stationId = update.stationId?.trim() || null
      if (!signedAt || Number.isNaN(Date.parse(signedAt))) throw new Error('请填写有效的签到时间')
      if (!stationId || stationId.length > 100) throw new Error('电脑名称须为 1 到 100 个字符')
    }
    const result = this.db.prepare(`
      UPDATE attendance_entries SET attendance = ?, signed_at = ?, station_id = ?
      WHERE session_id = ? AND student_id = ?
    `).run(update.attendance, signedAt, stationId, sessionId, studentId)
    if (!result.changes) throw new Error('该学生记录不存在或已删除')
    return this.get(sessionId)
  }

  deleteEntry(sessionId: string, studentId: string): ArchivedSessionDetail {
    const result = this.db.prepare(
      'DELETE FROM attendance_entries WHERE session_id = ? AND student_id = ?'
    ).run(sessionId, studentId)
    if (!result.changes) throw new Error('该学生记录不存在或已删除')
    return this.get(sessionId)
  }

  deleteSession(id: string): void {
    const result = this.db.prepare('DELETE FROM attendance_sessions WHERE id = ?').run(id)
    if (!result.changes) throw new Error('该历史场次不存在或已删除')
  }
}
