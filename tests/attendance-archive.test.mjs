import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import ExcelJS from 'exceljs'
import { AttendanceArchive } from '../src/main/attendance-archive.ts'
import { isLate } from '../src/main/attendance-time.ts'
import { exportAttendanceExcel } from '../src/main/attendance-export.ts'

test('场次归档、查询、修正、Excel 导出和删除', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sign-in-archive-test-'))
  const dbPath = join(dir, 'attendance.sqlite')
  const archive = new AttendanceArchive(dbPath)
  const session = {
    id: 'test-session',
    classId: 'class-1',
    className: '计算机一班',
    startedAt: '2026-11-04T01:00:00.000Z',
    active: true
  }
  const roster = [
    {
      studentId: '001',
      studentName: '张三',
      attendance: 'signed',
      signedAt: '2026-11-04T01:05:00.000Z',
      stationId: 'PC-01',
      idCardLast4: '1234'
    },
    { studentId: '002', studentName: '李四', attendance: 'absent', idCardLast4: '5678' },
    { studentId: '003', studentName: '王五', attendance: 'leave', idCardLast4: '9012' }
  ]
  archive.archive(session, roster, null)
  archive.archive(session, roster, null)
  assert.equal(archive.list({ keyword: '张三' }).total, 1)
  assert.equal(archive.list({ keyword: 'PC-01' }).total, 1)
  assert.equal(archive.list({ keyword: '不存在' }).total, 0)
  assert.equal(archive.list({ from: '2026-11-04', to: '2026-11-04' }).total, 1)
  assert.deepEqual(archive.get(session.id).session, {
    id: session.id,
    classId: session.classId,
    className: session.className,
    departmentName: null,
    startedAt: session.startedAt,
    endedAt: archive.get(session.id).session.endedAt,
    rosterNotice: null,
    lateAt: null,
    total: 3,
    signed: 1,
    late: 0,
    leave: 1,
    absent: 1
  })
  archive.updateSession(session.id, '计算机二班')
  archive.updateEntry(session.id, '002', {
    attendance: 'signed',
    signedAt: '2026-11-04T01:10:00.000Z',
    stationId: 'PC-02'
  })
  archive.updateEntry(session.id, '001', {
    attendance: 'late',
    signedAt: '2026-11-04T01:05:00.000Z',
    stationId: 'PC-01',
    mark: 'other',
    remark: '补录'
  })
  const detail = archive.get(session.id)
  assert.equal(detail.session.className, '计算机二班')
  assert.equal(detail.session.signed, 2)
  assert.equal(detail.session.late, 1)
  assert.equal(detail.entries.find((entry) => entry.studentId === '001')?.remark, '补录')
  assert.equal(detail.entries.find((entry) => entry.studentId === '002')?.stationId, 'PC-02')

  const xlsxPath = join(dir, 'attendance.xlsx')
  await exportAttendanceExcel(detail, xlsxPath)
  const book = new ExcelJS.Workbook()
  await book.xlsx.readFile(xlsxPath)
  assert.equal(book.getWorksheet('签到明细')?.getCell('A1').value, '计算机二班 签到记录')
  assert.equal(book.getWorksheet('签到明细')?.getCell('E8').value, 'PC-02')

  archive.deleteEntry(session.id, '003')
  assert.equal(archive.get(session.id).session.total, 2)
  archive.close()
  const reopened = new AttendanceArchive(dbPath)
  assert.equal(reopened.get(session.id).session.total, 2)
  reopened.deleteSession(session.id)
  assert.equal(reopened.list().total, 0)
  reopened.close()
})

test('旧历史数据库可升级并保存迟到与标记', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sign-in-archive-migration-'))
  const dbPath = join(dir, 'attendance.sqlite')
  const old = new DatabaseSync(dbPath)
  old.exec(`CREATE TABLE attendance_sessions (id TEXT PRIMARY KEY, class_id TEXT NOT NULL, class_name TEXT NOT NULL, department_name TEXT, started_at TEXT NOT NULL, ended_at TEXT NOT NULL, roster_notice TEXT);
    CREATE TABLE attendance_entries (session_id TEXT NOT NULL REFERENCES attendance_sessions(id) ON DELETE CASCADE, student_id TEXT NOT NULL, student_name TEXT NOT NULL, gender INTEGER, attendance TEXT NOT NULL CHECK(attendance IN ('signed', 'absent', 'leave')), signed_at TEXT, station_id TEXT, id_card_last4 TEXT, PRIMARY KEY (session_id, student_id));
    INSERT INTO attendance_sessions VALUES ('s', 'c', '班级', NULL, '2026-11-04T00:00:00Z', '2026-11-04T01:00:00Z', NULL);
    INSERT INTO attendance_entries VALUES ('s', '001', '张三', NULL, 'signed', '2026-11-04T00:20:01Z', 'PC', '1234');`)
  old.close()
  const archive = new AttendanceArchive(dbPath)
  const detail = archive.updateEntry('s', '001', {
    attendance: 'late',
    signedAt: '2026-11-04T00:20:01Z',
    stationId: 'PC',
    mark: 'other',
    remark: '补录'
  })
  assert.equal(detail.session.late, 1)
  assert.equal(detail.entries[0].remark, '补录')
  archive.close()
})

test('迟到从设定时间之后的第一秒开始', () => {
  const cutoff = '2026-11-05T14:20:00+08:00'
  assert.equal(isLate('2026-11-05T14:20:00+08:00', cutoff), false)
  assert.equal(isLate('2026-11-05T14:20:01+08:00', cutoff), true)
  assert.equal(isLate('2026-11-05T14:20:01+08:00'), false)
})
