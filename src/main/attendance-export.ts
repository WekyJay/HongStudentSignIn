import ExcelJS from 'exceljs'
import type { ArchivedSessionDetail } from '../shared/contracts'

const statusLabel = { signed: '已签到', late: '迟到', leave: '请假', absent: '未签到' } as const

function localTime(value?: string | null): string {
  return value ? new Date(value).toLocaleString('zh-CN') : ''
}

export async function exportAttendanceExcel(
  detail: ArchivedSessionDetail,
  filePath: string
): Promise<void> {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = '机房签到教师端'
  const sheet = workbook.addWorksheet('签到明细', {
    views: [{ state: 'frozen', ySplit: 6 }]
  })
  sheet.columns = [
    { key: 'studentId', width: 22 },
    { key: 'studentName', width: 18 },
    { key: 'attendance', width: 15 },
    { key: 'signedAt', width: 24 },
    { key: 'stationId', width: 23 },
    { key: 'idCardLast4', width: 19 },
    { key: 'mark', width: 25 }
  ]
  sheet.mergeCells('A1:G1')
  sheet.getCell('A1').value = `${detail.session.className} 签到记录`
  sheet.getCell('A1').font = { name: '微软雅黑', size: 17, bold: true, color: { argb: 'FF17345E' } }
  sheet.getRow(1).height = 32
  sheet.mergeCells('A2:G2')
  sheet.getCell('A2').value =
    `班级编号 ${detail.session.classId}    开始 ${localTime(detail.session.startedAt)}    结束 ${localTime(detail.session.endedAt)}`
  sheet.mergeCells('A3:G3')
  sheet.getCell('A3').value =
    `应到 ${detail.session.total} 人    实到 ${detail.session.signed} 人    迟到 ${detail.session.late} 人    请假 ${detail.session.leave} 人    未到 ${detail.session.absent} 人`
  if (detail.session.rosterNotice) {
    sheet.mergeCells('A4:G4')
    sheet.getCell('A4').value = `名单提示：${detail.session.rosterNotice}`
  }
  const heading = sheet.getRow(6)
  heading.values = ['学号', '姓名', '状态', '签到时间', '电脑名称', '身份证后四位', '标记与备注']
  heading.height = 25
  heading.eachCell((cell) => {
    cell.font = { name: '微软雅黑', bold: true, color: { argb: 'FFFFFFFF' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF315C93' } }
    cell.alignment = { vertical: 'middle' }
  })
  for (const entry of detail.entries) {
    const row = sheet.addRow([
      entry.studentId,
      entry.studentName,
      statusLabel[entry.attendance],
      localTime(entry.signedAt),
      entry.stationId || '',
      entry.idCardLast4 || '',
      entry.mark === 'withdrawn'
        ? `退学 ${entry.remark ?? ''}`.trim()
        : entry.mark === 'other'
          ? entry.remark || '其它情况'
          : entry.mark === 'leave'
            ? `请假 ${entry.remark ?? ''}`.trim()
            : ''
    ])
    row.height = 23
    row.eachCell((cell) => {
      cell.font = { name: '微软雅黑', size: 11 }
      cell.alignment = { vertical: 'middle' }
    })
  }
  sheet.autoFilter = { from: 'A6', to: `G${Math.max(6, 6 + detail.entries.length)}` }
  await workbook.xlsx.writeFile(filePath)
}
