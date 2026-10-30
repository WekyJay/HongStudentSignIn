import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import type { ThemeMode } from '../../../shared/contracts'

export type { ThemeMode } from '../../../shared/contracts'

function readThemeMode(): ThemeMode {
  try {
    const saved = localStorage.getItem('hong-sign-in-theme')
    if (saved === 'light' || saved === 'dark' || saved === 'system') return saved
  } catch {
    // Keep the default when browser storage is unavailable.
  }
  return 'system'
}

export const usePreferencesStore = defineStore('preferences', () => {
  const themeMode = ref<ThemeMode>(readThemeMode())
  const systemPrefersDark = ref(window.matchMedia('(prefers-color-scheme: dark)').matches)
  const resolvedTheme = computed(() =>
    themeMode.value === 'system' ? (systemPrefersDark.value ? 'dark' : 'light') : themeMode.value
  )

  function applyTheme(): void {
    document.documentElement.dataset.theme = resolvedTheme.value
    document.documentElement.style.colorScheme = resolvedTheme.value
  }

  function setThemeMode(mode: ThemeMode): void {
    themeMode.value = mode
  }

  function syncWindowTheme(mode: ThemeMode): void {
    void window.signIn.setThemeMode(mode).catch((error: unknown) => {
      console.error('同步窗口主题失败', error)
    })
  }

  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
  mediaQuery.addEventListener('change', (event) => {
    systemPrefersDark.value = event.matches
  })

  watch(themeMode, (mode) => {
    try {
      localStorage.setItem('hong-sign-in-theme', mode)
    } catch {
      // The preference still applies for this session without persistent storage.
    }
    applyTheme()
    syncWindowTheme(mode)
  })
  watch(systemPrefersDark, applyTheme)
  applyTheme()
  syncWindowTheme(themeMode.value)

  return { themeMode, resolvedTheme, setThemeMode }
})
