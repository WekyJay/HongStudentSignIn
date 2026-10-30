import { defineStore } from 'pinia'
import { ref, shallowRef } from 'vue'
import type { SchoolAuthState, SchoolClass, SchoolProfile } from '../../../shared/contracts'

export const useSchoolStore = defineStore('school', () => {
  const auth = shallowRef<SchoolAuthState | null>(null)
  const classes = shallowRef<SchoolClass[]>([])
  const classesLoaded = ref(false)
  const profile = shallowRef<SchoolProfile | null>(null)
  const profileLoading = ref(false)
  const profileError = ref('')
  const error = ref('')
  const busy = ref(false)
  const loadingClasses = ref(false)

  async function refreshStatus(): Promise<void> {
    try {
      auth.value = await window.signIn.getSchoolStatus()
      if (!auth.value.loggedIn) resetProfile()
    } catch {
      auth.value = null
      resetProfile()
    }
  }

  function resetProfile(): void {
    profile.value = null
    profileLoading.value = false
    profileError.value = ''
  }

  function applyAuth(next: SchoolAuthState): void {
    auth.value = next
    classesLoaded.value = false
    resetProfile()
  }

  async function logout(): Promise<void> {
    busy.value = true
    try {
      auth.value = await window.signIn.schoolLogout()
      classes.value = []
      classesLoaded.value = false
      resetProfile()
    } finally {
      busy.value = false
    }
  }

  async function loadProfile(force = false): Promise<void> {
    if (profileLoading.value) return
    if (profile.value && !force) return
    profileLoading.value = true
    profileError.value = ''
    try {
      profile.value = await window.signIn.getSchoolProfile(force)
    } catch (cause) {
      profileError.value = (cause as Error).message
    } finally {
      profileLoading.value = false
    }
  }

  async function loadClasses(force = false): Promise<void> {
    if (loadingClasses.value || (classesLoaded.value && !force)) return
    loadingClasses.value = true
    error.value = ''
    try {
      classes.value = await window.signIn.getSchoolClasses()
      classesLoaded.value = true
    } catch (cause) {
      error.value = (cause as Error).message
      await refreshStatus()
    } finally {
      loadingClasses.value = false
    }
  }

  return {
    auth,
    classes,
    classesLoaded,
    profile,
    profileLoading,
    profileError,
    error,
    busy,
    loadingClasses,
    refreshStatus,
    applyAuth,
    logout,
    loadProfile,
    loadClasses
  }
})
