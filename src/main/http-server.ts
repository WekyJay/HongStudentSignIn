import {
  createServer as createHttpServer,
  type IncomingMessage,
  type ServerResponse
} from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import { readFileSync } from 'node:fs'
import { extname, resolve, sep } from 'node:path'
import { gzipSync } from 'node:zlib'
import type { AddressInfo } from 'node:net'
import type { AppConfig, CheckinRequest, CheckinResult } from '../shared/contracts'
import { TeacherService } from './teacher-service'
import { TerminalRegistry } from './terminal-registry'

function json(response: ServerResponse, status: number, data: unknown): void {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  })
  response.end(JSON.stringify(data))
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  let body = ''
  for await (const chunk of request) {
    body += chunk.toString()
    if (body.length > 1024) throw new Error('请求内容过长')
  }
  return JSON.parse(body)
}

async function readTerminalReport(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let length = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    length += buffer.length
    if (length > 350_000) throw new Error('终端画面过大')
    chunks.push(buffer)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

export async function startTeacherServer(
  config: AppConfig,
  service: TeacherService,
  terminals: TerminalRegistry,
  rendererPath = resolve(__dirname, '../renderer'),
  studentPageInfo: { schoolName: string; schoolLogoDataUrl: string | null } = {
    schoolName: config.schoolName || '学校名称',
    schoolLogoDataUrl: null
  }
): Promise<() => Promise<void>> {
  // 学生端已经按场次状态自动收起窗口；按终端地址隔离成功记录即可沿用现有行为。
  const signedTerminals = new Map<string, { sessionId: string; stationId: string }>()
  const rendererRoot = resolve(rendererPath)
  const compressedAssets = new Map<string, Buffer>()
  const serveStudentPage = (
    request: IncomingMessage,
    response: ServerResponse,
    pathname: string
  ): boolean => {
    if (request.method !== 'GET' && request.method !== 'HEAD') return false
    let filePath: string
    if (pathname === '/student' || pathname === '/student/') {
      filePath = resolve(rendererRoot, 'index.html')
    } else if (pathname.startsWith('/assets/')) {
      filePath = resolve(rendererRoot, pathname.slice(1))
      if (!filePath.startsWith(`${rendererRoot}${sep}`)) {
        json(response, 404, { message: '页面资源不存在' })
        return true
      }
    } else {
      return false
    }

    let body: Buffer
    try {
      body = readFileSync(filePath)
    } catch {
      json(response, 404, { message: '页面资源不存在' })
      return true
    }
    const contentTypes: Record<string, string> = {
      '.css': 'text/css; charset=utf-8',
      '.html': 'text/html; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.webp': 'image/webp',
      '.woff': 'font/woff',
      '.woff2': 'font/woff2'
    }
    const extension = extname(filePath).toLowerCase()
    const isHtml = extension === '.html'
    const compressible = ['.css', '.html', '.js', '.json', '.svg'].includes(extension)
    const acceptsGzip = request.headers['accept-encoding']?.includes('gzip')
    let compressed = false
    if (acceptsGzip && compressible) {
      let cached = compressedAssets.get(filePath)
      if (!cached) {
        cached = gzipSync(body)
        compressedAssets.set(filePath, cached)
      }
      body = cached
      compressed = true
    }
    response.writeHead(200, {
      'content-type': contentTypes[extension] ?? 'application/octet-stream',
      'content-length': body.length,
      'cache-control': isHtml ? 'no-store' : 'public, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
      ...(compressible ? { vary: 'Accept-Encoding' } : {}),
      ...(compressed ? { 'content-encoding': 'gzip' } : {})
    })
    response.end(request.method === 'HEAD' ? undefined : body)
    return true
  }
  const handler = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    try {
      const path = new URL(request.url || '/', 'http://localhost').pathname
      if (request.method === 'GET' && path === '/health') {
        json(response, 200, { status: 'ok' })
        return
      }
      if (serveStudentPage(request, response, path)) return
      if (request.method === 'GET' && path === '/api/v1/runtime') {
        json(response, 200, studentPageInfo)
        return
      }
      if (request.method === 'GET' && path === '/api/v1/session') {
        const session = service.publicSession()
        const terminalAddress = request.socket.remoteAddress
        const signedTerminal = terminalAddress ? signedTerminals.get(terminalAddress) : undefined
        const checkedIn = Boolean(
          signedTerminal &&
          session?.id === signedTerminal.sessionId &&
          service.hasCheckinAtStation(signedTerminal.sessionId, signedTerminal.stationId)
        )
        if (terminalAddress && signedTerminal && !checkedIn) signedTerminals.delete(terminalAddress)
        const hideAfterCheckin = config.closeAfterCheckin !== false && session?.active && checkedIn
        json(response, 200, {
          session:
            session && !hideAfterCheckin ? { ...session, schoolName: config.schoolName } : null
        })
        return
      }
      if (request.method === 'POST' && path === '/api/v1/terminals/presence') {
        if (!request.headers['content-type']?.startsWith('application/json')) {
          json(response, 415, { message: '仅接受 JSON 请求' })
          return
        }
        const input = await readTerminalReport(request)
        if (!input || typeof input !== 'object') throw new Error('终端信息格式不正确')
        const report = input as { stationId?: unknown; screenDataUrl?: unknown }
        if (
          typeof report.stationId !== 'string' ||
          !report.stationId.trim() ||
          report.stationId.length > 100 ||
          (report.screenDataUrl !== undefined &&
            (typeof report.screenDataUrl !== 'string' ||
              !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(report.screenDataUrl)))
        ) {
          throw new Error('终端信息格式不正确')
        }
        terminals.update(report.stationId.trim(), report.screenDataUrl)
        json(response, 200, { ok: true })
        return
      }
      if (request.method === 'POST' && path === '/api/v1/checkins') {
        if (!request.headers['content-type']?.startsWith('application/json')) {
          json(response, 415, { message: '仅接受 JSON 请求' })
          return
        }
        const input = await readJson(request)
        if (!input || typeof input !== 'object') throw new Error('请求格式不正确')
        const data = input as Partial<CheckinRequest>
        if (
          typeof data.sessionId !== 'string' ||
          typeof data.idCard !== 'string' ||
          typeof data.stationId !== 'string' ||
          data.sessionId.length > 100 ||
          data.idCard.length > 30 ||
          data.stationId.length > 100 ||
          !data.stationId.trim()
        ) {
          throw new Error('签到参数不正确')
        }
        const result: CheckinResult = await service.checkin(data as CheckinRequest)
        if (result.code === 'SUCCESS' && config.closeAfterCheckin !== false) {
          const terminalAddress = request.socket.remoteAddress
          if (terminalAddress) {
            signedTerminals.set(terminalAddress, {
              sessionId: data.sessionId,
              stationId: data.stationId
            })
          }
        }
        const status =
          result.code === 'SUCCESS' ? 201 : result.code === 'DIRECTORY_UNAVAILABLE' ? 503 : 409
        json(response, status, result)
        return
      }
      json(response, 404, { message: '接口不存在' })
    } catch (error) {
      json(response, 400, { message: (error as Error).message })
    }
  }

  const server = config.tls
    ? createHttpsServer(
        { cert: readFileSync(config.tls.certPath), key: readFileSync(config.tls.keyPath) },
        handler
      )
    : createHttpServer(handler)

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(config.listenPort, config.listenHost, () => {
      server.off('error', reject)
      resolve()
    })
  })
  const address = server.address() as AddressInfo
  console.info(`教师服务已监听 ${address.address}:${address.port}`)
  return () =>
    new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    )
}
