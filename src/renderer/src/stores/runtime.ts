import { defineStore } from 'pinia'
import { ref, shallowRef } from 'vue'
import type { RuntimeInfo } from '../../../shared/contracts'

export const useRuntimeStore = defineStore('runtime', () => {
  const runtime = shallowRef<RuntimeInfo | null>(null)
  const initialized = ref(false)
  const error = ref('')

  async function initialize(): Promise<void> {
    if (initialized.value) return
    try {
      runtime.value = await window.signIn.getRuntimeInfo()
    } catch (cause) {
      error.value = (cause as Error).message
    } finally {
      initialized.value = true
    }
  }

  return { runtime, initialized, error, initialize }
})
