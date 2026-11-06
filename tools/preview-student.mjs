import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const configPath = join(tmpdir(), `hong-student-sign-in-preview-${process.pid}.json`)
const previewDataPath = mkdtempSync(join(tmpdir(), 'hong-student-sign-in-preview-data-'))
const teacherReportUrl = process.env.SIGNIN_PREVIEW_TEACHER_URL || 'http://127.0.0.1:41731'
const previewSession = {
  id: 'student-ui-preview',
  classId: 'PREVIEW-01',
  className: '计算机一班 · 界面预览',
  startedAt: new Date().toISOString(),
  active: true
}

const server = createServer((request, response) => {
  response.setHeader('content-type', 'application/json; charset=utf-8')
  response.setHeader('cache-control', 'no-store')
  if (request.method === 'GET' && request.url === '/api/v1/session') {
    response.end(JSON.stringify({ session: previewSession }))
    return
  }
  if (request.method === 'POST' && request.url === '/api/v1/checkins') {
    response.statusCode = 503
    response.end(
      JSON.stringify({ code: 'DIRECTORY_UNAVAILABLE', message: '界面预览不接入学生名单' })
    )
    return
  }
  response.statusCode = request.url === '/health' ? 200 : 404
  response.end(JSON.stringify({ status: request.url === '/health' ? 'ok' : 'not-found' }))
})

let devProcess
let cleaned = false

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function cleanup() {
  if (cleaned) return
  cleaned = true
  server.close()
  rmSync(configPath, { force: true })
  const temporaryRoot = resolve(tmpdir()) + sep
  if (resolve(previewDataPath).startsWith(temporaryRoot)) {
    rmSync(previewDataPath, { recursive: true, force: true })
  }
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
async function startPreview() {
  const address = server.address()
  let reportToTeacher = false
  try {
    const response = await fetch(new URL('/api/v1/terminals/presence', teacherReportUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ stationId: 'PREVIEW-PC', clientType: 'desktop' }),
      signal: AbortSignal.timeout(1500)
    })
    reportToTeacher = response.ok && (await response.json()).ok === true
  } catch {
    // The standalone preview still works when the teacher service is unavailable.
  }
  writeFileSync(
    configPath,
    JSON.stringify(
      {
        role: 'student',
        stationId: 'PREVIEW-PC',
        teacherUrl: `http://127.0.0.1:${address.port}`,
        listenHost: '127.0.0.1',
        listenPort: 41733
      },
      null,
      2
    )
  )

  const electronViteCli = join(root, 'node_modules', 'electron-vite', 'bin', 'electron-vite.js')
  const childEnvironment = {
    ...process.env,
    SIGNIN_CONFIG_PATH: configPath,
    SIGNIN_UI_PREVIEW: '1',
    SIGNIN_PREVIEW_REPORT_URL: teacherReportUrl,
    ELECTRON_CLI_ARGS: JSON.stringify([`--user-data-dir=${previewDataPath}`])
  }
  delete childEnvironment.ELECTRON_RUN_AS_NODE

  devProcess = spawn(process.execPath, [electronViteCli, 'dev'], {
    cwd: root,
    stdio: 'inherit',
    env: childEnvironment
  })
  devProcess.once('error', (error) => {
    console.error('无法启动 Electron 预览：', error.message)
    cleanup()
    process.exitCode = 1
  })
  devProcess.once('exit', (code) => {
    if (code !== 0) console.error(`学生端预览进程退出，代码 ${code ?? 'unknown'}`)
    cleanup()
    process.exitCode = code ?? 0
  })
  console.log(
    reportToTeacher
      ? `预览机 PREVIEW-PC 将出现在 ${teacherReportUrl} 的连接管理中。`
      : `独立界面预览已启动；${teacherReportUrl} 当前没有可用的新版教师服务，服务启动后预览机会自动出现在连接管理中。`
  )
  console.log('关闭预览窗口后，在此终端按 Ctrl+C 结束预览服务。')
}

server.listen(0, '127.0.0.1', () => {
  void startPreview()
})
server.once('error', (error) => {
  console.error('无法启动临时预览服务：', error.message)
  cleanup()
  process.exitCode = 1
})

process.once('SIGINT', () => {
  if (devProcess && !devProcess.killed) devProcess.kill()
  cleanup()
  process.exit(130)
})
