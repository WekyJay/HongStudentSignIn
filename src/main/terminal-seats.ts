import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { TerminalSeatAssignments } from '../shared/contracts'

export class TerminalSeats {
  private seats: TerminalSeatAssignments = {}
  private readonly path: string

  constructor(path: string) {
    this.path = path
    try {
      const saved: unknown = JSON.parse(readFileSync(path, 'utf8'))
      if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return
      for (const [stationId, seat] of Object.entries(saved)) {
        if (typeof seat === 'string' && seat.trim()) this.seats[stationId] = seat.trim()
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn('[terminal-seats] failed to load:', (error as Error).message)
      }
    }
  }

  list(): TerminalSeatAssignments {
    return { ...this.seats }
  }

  set(stationId: string, seatLabel: string): TerminalSeatAssignments {
    const seat = seatLabel.trim()
    if (!stationId.trim() || stationId.length > 100 || hasControlCharacter(stationId)) {
      throw new Error('机器名称无效')
    }
    if (seat.length > 24 || hasControlCharacter(seat)) throw new Error('座位号无效或超过 24 个字符')
    if (
      seat &&
      Object.entries(this.seats).some(
        ([otherStation, otherSeat]) =>
          otherStation !== stationId && otherSeat.toLocaleLowerCase() === seat.toLocaleLowerCase()
      )
    ) {
      throw new Error('这个座位号已分配给其他机器')
    }
    const nextSeats = { ...this.seats }
    if (seat) nextSeats[stationId] = seat
    else delete nextSeats[stationId]
    mkdirSync(dirname(this.path), { recursive: true })
    const temporaryPath = `${this.path}.${process.pid}.tmp`
    writeFileSync(temporaryPath, JSON.stringify(nextSeats, null, 2), 'utf8')
    renameSync(temporaryPath, this.path)
    this.seats = nextSeats
    return this.list()
  }
}

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => character.charCodeAt(0) < 32)
}
