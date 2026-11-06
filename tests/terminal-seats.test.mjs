import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { TerminalSeats } from '../src/main/terminal-seats.ts'

test('座位绑定在重启后保留，且不能分配重复座位', () => {
  const directory = mkdtempSync(join(tmpdir(), 'terminal-seats-'))
  try {
    const path = join(directory, 'seats.json')
    const seats = new TerminalSeats(path)
    assert.deepEqual(seats.set('PC-01', ' A01 '), { 'PC-01': 'A01' })
    assert.throws(() => seats.set('PC-02', 'a01'), /已分配/)
    assert.deepEqual(new TerminalSeats(path).list(), { 'PC-01': 'A01' })
    assert.deepEqual(seats.set('PC-01', ''), {})
    assert.deepEqual(new TerminalSeats(path).list(), {})
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
