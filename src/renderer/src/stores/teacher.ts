import { defineStore } from 'pinia'
import { ref, shallowRef } from 'vue'
import type { TeacherSnapshot } from '../../../shared/contracts'

export const useTeacherStore = defineStore('teacher', () => {
  const snapshot = shallowRef<TeacherSnapshot | null>(null)
  const error = ref('')
  const busy = ref(false)
  const polling = ref(false)
  const refreshing = ref(false)
  let timer: ReturnType<typeof setInterval> | undefined

  async function refresh(): Promise<void> {
    if (refreshing.value) return
    refreshing.value = true
    try {
      snapshot.value = await window.signIn.getTeacherSnapshot()
      error.value = ''
    } catch (cause) {
      error.value = (cause as Error).message
    } finally {
      refreshing.value = false
    }
  }

  function startPolling(): void {
    stopPolling()
    polling.value = true
    void refresh()
    timer = setInterval(() => void refresh(), 3000)
  }

  function stopPolling(): void {
    polling.value = false
    if (timer) clearInterval(timer)
    timer = undefined
  }

  async function startSession(
    classId: string,
    className: string,
    classSize?: number,
    departmentName?: string
  ): Promise<void> {
    busy.value = true
    error.value = ''
    try {
      snapshot.value = await window.signIn.startSession(
        classId,
        className,
        classSize,
        departmentName
      )
    } catch (cause) {
      error.value = (cause as Error).message
    } finally {
      busy.value = false
    }
  }

  async function stopSession(): Promise<boolean> {
    busy.value = true
    error.value = ''
    try {
      snapshot.value = await window.signIn.stopSession()
      return true
    } catch (cause) {
      error.value = (cause as Error).message
      return false
    } finally {
      busy.value = false
    }
  }

  async function markLeave(studentId: string): Promise<void> {
    try {
      snapshot.value = await window.signIn.markLeave(studentId)
    } catch (cause) {
      error.value = (cause as Error).message
    }
  }

  async function clearLeave(studentId: string): Promise<void> {
    try {
      snapshot.value = await window.signIn.clearLeave(studentId)
    } catch (cause) {
      error.value = (cause as Error).message
    }
  }

  async function resetCheckin(studentId: string): Promise<void> {
    busy.value = true
    error.value = ''
    try {
      snapshot.value = await window.signIn.resetCheckin(studentId)
    } catch (cause) {
      error.value = (cause as Error).message
    } finally {
      busy.value = false
    }
  }

  async function resetSessionCheckins(): Promise<void> {
    busy.value = true
    error.value = ''
    try {
      snapshot.value = await window.signIn.resetSessionCheckins()
    } catch (cause) {
      error.value = (cause as Error).message
    } finally {
      busy.value = false
    }
  }

  return {
    snapshot,
    error,
    busy,
    polling,
    refreshing,
    refresh,
    startPolling,
    stopPolling,
    startSession,
    stopSession,
    markLeave,
    clearLeave,
    resetCheckin,
    resetSessionCheckins
  }
})
