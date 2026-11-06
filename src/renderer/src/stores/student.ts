import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import type { CheckinResult, PublicSession } from '../../../shared/contracts'
import {
  getStudentSession,
  onStudentSessionStarted,
  submitStudentCheckin
} from '../lib/student-client'

export const useStudentStore = defineStore('student', () => {
  const session = shallowRef<PublicSession | null>(null)
  const idCard = ref('')
  const result = shallowRef<CheckinResult | null>(null)
  const connectionError = ref('')
  const busy = ref(false)
  const polling = ref(false)
  const refreshing = ref(false)
  const canSubmit = computed(
    () =>
      !!session.value?.active &&
      !connectionError.value &&
      idCard.value.trim().length === 18 &&
      !busy.value
  )
  let timer: ReturnType<typeof setInterval> | undefined
  let unsubscribeSessionStarted: (() => void) | undefined

  async function refresh(): Promise<void> {
    if (refreshing.value) return
    refreshing.value = true
    try {
      const next = await getStudentSession()
      if (next?.id !== session.value?.id) result.value = null
      session.value = next
      connectionError.value = ''
      // 场次结束后界面由主进程隐藏回托盘，渲染进程继续轮询，等待下一场签到
    } catch {
      connectionError.value = '无法连接教师机，请检查网络或联系老师。'
    } finally {
      refreshing.value = false
    }
  }

  function startPolling(): void {
    stopPolling()
    polling.value = true
    unsubscribeSessionStarted = onStudentSessionStarted(() => void refresh())
    void refresh()
    timer = setInterval(() => void refresh(), 4000)
  }

  function stopPolling(): void {
    polling.value = false
    unsubscribeSessionStarted?.()
    unsubscribeSessionStarted = undefined
    if (timer) clearInterval(timer)
    timer = undefined
  }

  async function submit(): Promise<void> {
    const activeSession = session.value
    if (!canSubmit.value || !activeSession) return
    busy.value = true
    result.value = null
    try {
      result.value = await submitStudentCheckin(activeSession.id, idCard.value.trim().toUpperCase())
    } catch {
      result.value = { code: 'NETWORK_ERROR', message: '提交失败，请检查网络后重试' }
    } finally {
      idCard.value = ''
      busy.value = false
    }
  }

  return {
    session,
    idCard,
    result,
    connectionError,
    busy,
    polling,
    refreshing,
    canSubmit,
    refresh,
    startPolling,
    stopPolling,
    submit
  }
})
