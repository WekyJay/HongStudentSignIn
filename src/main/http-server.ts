import {
  createServer as createHttpServer,
  type IncomingMessage,
  type ServerResponse
} from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import { readFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import type { AppConfig, CheckinRequest, CheckinResult } from '../shared/contracts'
import { TeacherService } from './teacher-service'

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

export async function startTeacherServer(
  config: AppConfig,
  service: TeacherService
): Promise<() => Promise<void>> {
  // 学生端已经按场次状态自动收起窗口；按终端地址隔离成功记录即可沿用现有行为。
  const signedTerminals = new Map<string, { sessionId: string; stationId: string }>()
  const handler = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    try {
      const path = new URL(request.url || '/', 'http://localhost').pathname
      if (request.method === 'GET' && path === '/health') {
        json(response, 200, { status: 'ok' })
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
