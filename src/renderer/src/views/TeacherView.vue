<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import {
  Activity,
  ArrowUpRight,
  CalendarOff,
  Check,
  ClipboardList,
  Clock3,
  Eye,
  RefreshCw,
  Computer,
  GraduationCap,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Monitor,
  Moon,
  Minus,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  PanelTop,
  Plus,
  RotateCcw,
  Settings2,
  ShieldCheck,
  Square,
  Sun,
  TriangleAlert,
  X
} from '@lucide/vue'
import Button from '../components/ui/button/Button.vue'
import Badge from '../components/ui/badge/Badge.vue'
import Card from '../components/ui/card/Card.vue'
import SchoolLogin from '../components/SchoolLogin.vue'
import DeploymentSettings from '../components/DeploymentSettings.vue'
import AttendanceHistory from '../components/AttendanceHistory.vue'
import ConnectionManagement from '../components/ConnectionManagement.vue'
import ClassPicker from '../components/ClassPicker.vue'
import Dialog from '../components/ui/dialog/Dialog.vue'
import type { RosterEntry, StudentMark } from '../../../shared/contracts'
import { useRuntimeStore } from '../stores/runtime'
import { useSchoolStore } from '../stores/school'
import { useTeacherStore } from '../stores/teacher'
import { usePreferencesStore, type ThemeMode } from '../stores/preferences'

type TeacherSection = 'overview' | 'session' | 'records' | 'connections' | 'terminal' | 'settings'

const runtimeStore = useRuntimeStore()
const schoolStore = useSchoolStore()
const teacherStore = useTeacherStore()
const preferencesStore = usePreferencesStore()
const { runtime } = storeToRefs(runtimeStore)
const {
  auth: schoolAuth,
  classes,
  loadingClasses,
  error: schoolError,
  profile: schoolProfile,
  profileLoading,
  profileError
} = storeToRefs(schoolStore)
const { snapshot, error, busy } = storeToRefs(teacherStore)
const { themeMode } = storeToRefs(preferencesStore)
const selectedClassId = ref('')
const activeSection = ref<TeacherSection>('overview')
const recordsTab = ref<'current' | 'history'>('current')
const settingsOpen = ref(false)
const sidebarCollapsed = ref(false)
const maximized = ref(false)
const lateTime = ref('')
const idCardEntry = ref<RosterEntry | null>(null)
const markEntry = ref<RosterEntry | null>(null)
const markDraft = ref<'' | StudentMark>('')
const remarkDraft = ref('')
const markDialogOpen = ref(false)
const idDialogOpen = ref(false)
const avatarPreview = ref<{ name: string; src: string } | null>(null)
const avatarPreviewOpen = computed({
  get: () => avatarPreview.value !== null,
  set: (open: boolean) => {
    if (!open) avatarPreview.value = null
  }
})
const avatarImages = reactive(new Map<string, string>())
const pendingAvatarImages = new Set<string>()
let removeWindowListener: (() => void) | undefined

const menuItems: {
  id: TeacherSection
  label: string
  icon: typeof LayoutDashboard
}[] = [
  { id: 'overview', label: '工作台', icon: LayoutDashboard },
  { id: 'session', label: '场次管理', icon: ClipboardList },
  { id: 'records', label: '签到记录', icon: ListChecks },
  { id: 'connections', label: '连接管理', icon: Monitor },
  { id: 'terminal', label: '终端信息', icon: Computer },
  { id: 'settings', label: '设置', icon: Settings2 }
]
const themeOptions: {
  mode: ThemeMode
  label: string
  description: string
  icon: typeof Monitor
}[] = [
  { mode: 'system', label: '跟随系统', description: '自动匹配 Windows 外观', icon: Monitor },
  { mode: 'light', label: '浅色', description: '使用明亮的工作界面', icon: Sun },
  { mode: 'dark', label: '深色', description: '在低光环境下减少眩光', icon: Moon }
]
const activeMenu = computed(() => menuItems.find((item) => item.id === activeSection.value)!)
const recentCheckins = computed(() => (snapshot.value?.checkins ?? []).slice(-5).reverse())
const serviceReady = computed(() => !runtime.value?.serverError)
const needsInitialSetup = computed(
  () =>
    !!runtime.value &&
    (!runtime.value.schoolServerUrl ||
      !runtime.value.wechatAppId ||
      !runtime.value.wechatRedirectUri)
)
const selectedClass = computed(
  () => classes.value.find((item) => item.id === selectedClassId.value) ?? null
)
const rosterStats = computed(() => {
  const roster = snapshot.value?.roster ?? []
  const signed = roster.filter(
    (entry) => entry.attendance === 'signed' || entry.attendance === 'late'
  ).length
  const late = roster.filter((entry) => entry.attendance === 'late').length
  const leave = roster.filter((entry) => entry.attendance === 'leave').length
  return { total: roster.length, signed, late, leave, absent: roster.length - signed - leave }
})
const todayLabel = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  weekday: 'long'
}).format(new Date())
const profileInitial = computed(
  () => (schoolProfile.value?.displayName || '师').trim().slice(0, 1) || '师'
)

function avatarImageKey(url: string, size: 'thumbnail' | 'preview'): string {
  return `${size}:${url}`
}

async function loadStudentAvatar(
  url: string | null | undefined,
  size: 'thumbnail' | 'preview'
): Promise<string | null> {
  if (!url) return null
  const key = avatarImageKey(url, size)
  const cached = avatarImages.get(key)
  if (cached) return cached
  if (pendingAvatarImages.has(key)) return null
  pendingAvatarImages.add(key)
  try {
    const image = await window.signIn.getStudentAvatar(url, size)
    if (image) avatarImages.set(key, image)
    return image
  } catch {
    return null
  } finally {
    pendingAvatarImages.delete(key)
  }
}

watch(
  () =>
    snapshot.value?.roster?.flatMap((entry) => (entry.avatarUrl ? [entry.avatarUrl] : [])) ?? [],
  (avatarUrls) => {
    void preloadRosterAvatars([...new Set(avatarUrls)])
  },
  { immediate: true }
)

async function preloadRosterAvatars(avatarUrls: string[]): Promise<void> {
  let nextIndex = 0
  const workers = Array.from({ length: Math.min(6, avatarUrls.length) }, async () => {
    while (nextIndex < avatarUrls.length) {
      const avatarUrl = avatarUrls[nextIndex++]
      await loadStudentAvatar(avatarUrl, 'thumbnail')
    }
  })
  await Promise.all(workers)
}

async function openAvatarPreview(entry: RosterEntry): Promise<void> {
  if (!entry.avatarUrl) return
  const src = await loadStudentAvatar(entry.avatarUrl, 'preview')
  if (src) avatarPreview.value = { name: entry.studentName, src }
}

function setSection(section: TeacherSection): void {
  activeSection.value = section
  if (section === 'settings' && schoolAuth.value?.loggedIn) void schoolStore.loadProfile()
}

function setTheme(mode: ThemeMode): void {
  preferencesStore.setThemeMode(mode)
}

function minimizeWindow(): void {
  void window.signIn.minimizeWindow()
}
function toggleMaximizeWindow(): void {
  void window.signIn.toggleMaximizeWindow()
}
function closeWindow(): void {
  void window.signIn.closeWindow()
}

function startSelectedSession(): void {
  const target = selectedClass.value
  if (!target) return
  const today = new Date()
  const [hour, minute] = lateTime.value.split(':').map(Number)
  const lateAt = lateTime.value
    ? new Date(
        today.getFullYear(),
        today.getMonth(),
        today.getDate(),
        hour,
        minute,
        0
      ).toISOString()
    : undefined
  void teacherStore.startSession(
    target.id,
    target.className,
    target.size,
    target.departmentName,
    lateAt
  )
}

function openMark(entry: RosterEntry): void {
  error.value = ''
  markEntry.value = entry
  markDraft.value = entry.mark ?? ''
  remarkDraft.value = entry.remark ?? ''
  markDialogOpen.value = true
}

async function saveMark(): Promise<void> {
  if (!markEntry.value) return
  if (
    await teacherStore.setMark(
      markEntry.value.studentId,
      markDraft.value || undefined,
      remarkDraft.value
    )
  )
    markDialogOpen.value = false
}

function showIdCard(entry: RosterEntry): void {
  idCardEntry.value = entry
  idDialogOpen.value = true
}

async function endCurrentSession(): Promise<void> {
  if (await teacherStore.stopSession()) {
    recordsTab.value = 'history'
    activeSection.value = 'records'
  }
}

function resetEntryCheckin(entry: { studentId: string; studentName: string }): void {
  if (!window.confirm(`确定让 ${entry.studentName} 重新签到吗？将清除该学生本场的签到记录。`)) {
    return
  }
  void teacherStore.resetCheckin(entry.studentId)
}

function resetAllCheckins(): void {
  if (!snapshot.value?.session?.active || !rosterStats.value.signed) return
  if (
    !window.confirm(
      `确定让全班重新签到吗？将清除本场 ${rosterStats.value.signed} 名学生的签到记录，请假标记保留。`
    )
  ) {
    return
  }
  void teacherStore.resetSessionCheckins()
}

async function logoutSchool(): Promise<void> {
  await schoolStore.logout()
}

// 登录成功后（含启动时恢复登录、设置页退出后重新扫码）拉取账号资料
watch(
  () => schoolAuth.value?.loggedIn,
  (loggedIn) => {
    if (loggedIn) void schoolStore.loadProfile()
  }
)

onMounted(async () => {
  teacherStore.startPolling()
  await schoolStore.refreshStatus()
  if (schoolAuth.value?.loggedIn) void schoolStore.loadClasses()
  maximized.value = await window.signIn.getWindowMaximized()
  removeWindowListener = window.signIn.onWindowMaximized((value) => {
    maximized.value = value
  })
})
onUnmounted(() => {
  teacherStore.stopPolling()
  removeWindowListener?.()
})
</script>

<template>
  <Dialog
    v-model:open="idDialogOpen"
    :title="`${idCardEntry?.studentName ?? ''}的身份证号码`"
    description="仅供现场核对，请勿向无关人员展示。"
  >
    <p class="full-id-card tabular-nums">{{ idCardEntry?.idCard || '暂无身份证号码' }}</p>
  </Dialog>
  <Dialog
    v-model:open="avatarPreviewOpen"
    :title="avatarPreview ? `${avatarPreview.name}的头像` : '学生头像'"
  >
    <img
      v-if="avatarPreview"
      class="student-avatar-preview"
      :src="avatarPreview.src"
      :alt="`${avatarPreview.name}的头像预览`"
    />
  </Dialog>
  <Dialog
    v-model:open="markDialogOpen"
    :title="`标记 ${markEntry?.studentName ?? ''}`"
    description="标记和备注会保存到本场历史记录。"
  >
    <form class="mark-form" @submit.prevent="saveMark">
      <p v-if="error" class="roster-notice" role="alert">{{ error }}</p>
      <label
        >学生标记<select v-model="markDraft">
          <option value="">无标记</option>
          <option value="leave">请假</option>
          <option value="withdrawn">退学</option>
          <option value="other">其它情况</option>
        </select></label
      >
      <label v-if="markDraft === 'other'"
        >其它情况<input v-model="remarkDraft" required maxlength="100" placeholder="输入具体情况"
      /></label>
      <label v-else-if="markDraft"
        >备注（可选）<input v-model="remarkDraft" maxlength="100" placeholder="补充说明"
      /></label>
      <div class="mark-actions">
        <Button type="button" variant="ghost" @click="markDialogOpen = false">取消</Button
        ><Button type="submit" :disabled="busy">保存标记</Button>
      </div>
    </form>
  </Dialog>
  <DeploymentSettings
    v-if="runtime && (needsInitialSetup || (!schoolAuth?.loggedIn && settingsOpen))"
    :settings="runtime.appSettings"
    :logo-data-url="runtime.schoolLogoDataUrl"
    :teacher-url="runtime.teacherUrl"
    :first-run="needsInitialSetup"
    :standalone="needsInitialSetup || (!schoolAuth?.loggedIn && settingsOpen)"
    @close="settingsOpen = false"
  />
  <SchoolLogin v-else-if="!schoolAuth?.loggedIn" @open-settings="settingsOpen = true" />
  <main
    v-else
    class="teacher-window flex h-screen overflow-hidden bg-background text-foreground"
    :class="{ 'theme-dark': preferencesStore.resolvedTheme === 'dark' }"
  >
    <aside
      class="teacher-sidebar flex shrink-0 flex-col"
      :class="sidebarCollapsed ? 'is-collapsed' : 'is-expanded'"
    >
      <div class="sidebar-brand flex items-center gap-3">
        <div
          class="brand-mark grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground"
        >
          <img
            v-if="runtime?.schoolLogoDataUrl"
            class="h-full w-full rounded-xl object-contain"
            :src="runtime.schoolLogoDataUrl"
            :alt="runtime.schoolName"
          />
          <GraduationCap v-else :size="20" :stroke-width="2.2" />
        </div>
        <div v-if="!sidebarCollapsed" class="min-w-0 flex-1 leading-tight">
          <p class="m-0 truncate text-sm font-bold tracking-wide">
            {{ runtime?.schoolName || '学校名称' }}
          </p>
          <p class="m-0 mt-1 text-[11px] text-muted-foreground">教师工作台</p>
        </div>
        <Button
          v-if="!sidebarCollapsed"
          variant="ghost"
          size="icon"
          class="sidebar-toggle"
          :aria-label="sidebarCollapsed ? '展开侧栏' : '收起侧栏'"
          :title="sidebarCollapsed ? '展开侧栏' : '收起侧栏'"
          @click="sidebarCollapsed = !sidebarCollapsed"
        >
          <PanelLeftClose :size="17" />
        </Button>
      </div>

      <div v-if="!sidebarCollapsed" class="sidebar-section-label">工作空间</div>
      <nav class="sidebar-nav" aria-label="教师端导航">
        <Button
          v-for="item in menuItems"
          :key="item.id"
          :variant="activeSection === item.id ? 'secondary' : 'ghost'"
          size="default"
          class="sidebar-item justify-start text-left"
          :aria-current="activeSection === item.id ? 'page' : undefined"
          :title="item.label"
          @click="setSection(item.id)"
        >
          <component :is="item.icon" :size="18" :stroke-width="1.9" />
          <span v-if="!sidebarCollapsed">{{ item.label }}</span>
          <span v-if="!sidebarCollapsed && activeSection === item.id" class="sidebar-active-dot" />
        </Button>
      </nav>

      <div class="sidebar-spacer" />
      <div class="sidebar-status" :class="{ 'sidebar-status-collapsed': sidebarCollapsed }">
        <Button
          v-if="sidebarCollapsed"
          variant="secondary"
          size="icon"
          class="sidebar-expand-button"
          aria-label="展开侧栏"
          title="展开侧栏"
          @click="sidebarCollapsed = false"
        >
          <PanelLeftOpen :size="17" />
        </Button>
        <template v-else>
          <span class="sidebar-status-icon" :class="serviceReady ? 'is-online' : 'is-offline'"
            ><Network :size="16"
          /></span>
          <div class="min-w-0">
            <div class="flex items-center gap-2 text-xs font-semibold">
              <span
                class="service-light"
                :class="serviceReady ? 'service-light-online' : 'service-light-offline'"
              />{{ serviceReady ? '本机服务正常' : '服务异常' }}
            </div>
            <p class="m-0 mt-1 truncate text-[11px] text-muted-foreground">
              {{ runtime?.stationId || '终端连接状态' }}
            </p>
          </div>
        </template>
      </div>
    </aside>

    <div class="teacher-main flex min-w-0 flex-1 flex-col">
      <header
        class="teacher-menubar flex h-16 shrink-0 items-center justify-between border-b border-border px-6"
      >
        <div class="titlebar-copy min-w-0">
          <div class="flex items-center gap-2">
            <h1 class="m-0 truncate text-[15px] font-bold">{{ activeMenu.label }}</h1>
            <Badge v-if="snapshot?.session?.active" variant="secondary" class="session-header-badge"
              ><span class="session-dot" />签到进行中</Badge
            >
          </div>
        </div>
        <div class="titlebar-tools flex h-full shrink-0 items-center gap-3">
          <span v-if="!snapshot?.session?.active" class="today-label">{{ todayLabel }}</span>
          <Badge
            :variant="serviceReady ? 'secondary' : 'destructive'"
            :class="serviceReady ? 'service-chip service-chip-online' : 'service-chip'"
          >
            <span class="service-light" />{{ serviceReady ? '本机服务正常' : '服务异常' }}
          </Badge>
          <div class="window-controls flex h-full items-center" aria-label="窗口控制">
            <Button
              variant="ghost"
              size="icon"
              class="window-control"
              aria-label="最小化窗口"
              title="最小化"
              @click="minimizeWindow"
            >
              <Minus :size="15" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              class="window-control"
              :aria-label="maximized ? '还原窗口' : '最大化窗口'"
              :title="maximized ? '还原' : '最大化'"
              @click="toggleMaximizeWindow"
            >
              <PanelTop v-if="maximized" :size="14" /><Square v-else :size="14" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              class="window-control"
              aria-label="关闭窗口"
              title="关闭"
              @click="closeWindow"
            >
              <X :size="15" />
            </Button>
          </div>
        </div>
      </header>

      <div class="teacher-content min-h-0 flex-1 overflow-y-auto px-8 py-7">
        <div
          v-if="runtime?.serverError"
          class="mx-auto mb-4 max-w-280 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          教师服务启动失败：{{ runtime.serverError }}
        </div>
        <div
          v-if="error"
          class="mx-auto mb-4 max-w-280 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {{ error }}
        </div>

        <div v-if="activeSection === 'overview'" class="mx-auto max-w-280">
          <div class="mb-6 flex items-end justify-between gap-6">
            <div>
              <div
                class="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-primary"
              >
                <Activity :size="14" />签到中心
              </div>
              <h1 class="m-0 text-2xl font-bold tracking-tight">签到概况</h1>
            </div>
            <Button @click="setSection('session')"
              ><Plus :size="16" />{{
                snapshot?.session?.active ? '管理当前场次' : '开启签到场次'
              }}</Button
            >
          </div>

          <div class="mb-5 grid grid-cols-1 gap-4 md:grid-cols-3">
            <Card class="summary-panel">
              <div class="summary-icon bg-blue-50 text-primary"><Check :size="19" /></div>
              <p class="summary-label">本场已签到</p>
              <div class="flex items-baseline gap-2">
                <strong class="summary-number">{{ rosterStats.signed }}</strong
                ><span class="text-sm text-muted-foreground"
                  >/ {{ snapshot?.roster ? rosterStats.total : '—' }} 人</span
                >
              </div>
              <p class="summary-foot">
                {{
                  snapshot?.roster
                    ? `请假 ${rosterStats.leave} 人 · 未到 ${rosterStats.absent} 人`
                    : '按学生编号去重统计'
                }}
              </p>
            </Card>
            <Card class="summary-panel">
              <div class="summary-icon bg-violet-50 text-violet-600">
                <GraduationCap :size="19" />
              </div>
              <p class="summary-label">当前班级</p>
              <strong class="summary-name">{{
                snapshot?.session?.active ? snapshot.session.className : '未开启场次'
              }}</strong>
              <p class="summary-foot">
                {{
                  snapshot?.session?.active
                    ? `班级编号 ${snapshot.session.classId}`
                    : '开始场次后学生端即可签到'
                }}
              </p>
            </Card>
            <Card class="summary-panel">
              <div class="summary-icon bg-emerald-50 text-emerald-600">
                <ShieldCheck :size="19" />
              </div>
              <p class="summary-label">服务状态</p>
              <strong
                class="summary-name"
                :class="serviceReady ? 'text-green-700' : 'text-red-700'"
                >{{ serviceReady ? '运行正常' : '需要处理' }}</strong
              >
              <p class="summary-foot truncate">监听地址 {{ runtime?.teacherUrl }}</p>
            </Card>
          </div>

          <Card class="content-panel">
            <div class="mb-5 flex items-center justify-between gap-4">
              <div>
                <h2 class="panel-title">当前场次</h2>
                <p class="panel-subtitle">
                  {{
                    snapshot?.session?.active ? '学生端正在接收本场签到' : '还没有进行中的签到场次'
                  }}
                </p>
              </div>
              <Badge :variant="snapshot?.session?.active ? 'secondary' : 'outline'">{{
                snapshot?.session?.active ? '进行中' : '未开始'
              }}</Badge>
            </div>
            <div v-if="snapshot?.session?.active" class="session-summary">
              <div>
                <span>班级</span><strong>{{ snapshot.session.className }}</strong>
              </div>
              <div>
                <span>班级编号</span><strong>{{ snapshot.session.classId }}</strong>
              </div>
              <div>
                <span>开始时间</span
                ><strong>{{ new Date(snapshot.session.startedAt).toLocaleString('zh-CN') }}</strong>
              </div>
              <div v-if="snapshot.roster">
                <span>考勤分布</span
                ><strong
                  >实到 {{ rosterStats.signed }} · 请假 {{ rosterStats.leave }} · 未到
                  {{ rosterStats.absent }}</strong
                >
              </div>
            </div>
            <div v-else class="empty-session">
              <span class="empty-session-mark"><ClipboardList :size="20" /></span>
              <span>开启一个班级场次，学生端将自动显示签到入口。</span>
              <Button variant="secondary" class="ml-auto" @click="setSection('session')"
                >设置场次<ArrowUpRight :size="15"
              /></Button>
            </div>
          </Card>

          <Card class="content-panel mt-5">
            <div class="mb-4 flex items-center justify-between">
              <div>
                <h2 class="panel-title">最近签到</h2>
                <p class="panel-subtitle">显示当前场次最新的签到记录</p>
              </div>
              <Button variant="ghost" size="sm" @click="setSection('records')"
                >查看全部<ArrowUpRight :size="15"
              /></Button>
            </div>
            <div v-if="!recentCheckins.length" class="empty-records">当前场次还没有签到记录</div>
            <div v-else class="record-list">
              <div v-for="record in recentCheckins" :key="record.studentId" class="record-row">
                <div class="record-avatar">{{ record.studentName.slice(0, 1) }}</div>
                <div class="record-person">
                  <strong>{{ record.studentName }}</strong
                  ><span>{{ record.studentId }}</span>
                </div>
                <span class="record-terminal">电脑 {{ record.stationId }}</span>
                <span class="record-time"
                  ><Clock3 :size="13" />{{
                    new Date(record.signedAt).toLocaleTimeString('zh-CN')
                  }}</span
                >
                <span class="record-check"><Check :size="14" /></span>
              </div>
            </div>
          </Card>
        </div>

        <div v-else-if="activeSection === 'session'" class="mx-auto max-w-280">
          <div class="mb-6">
            <div
              class="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-primary"
            >
              <ClipboardList :size="14" />场次配置
            </div>
            <h1 class="m-0 text-2xl font-bold tracking-tight">场次管理</h1>
          </div>
          <Card class="content-panel">
            <div class="mb-5 flex items-center justify-between">
              <div>
                <h2 class="panel-title">
                  {{ snapshot?.session?.active ? '正在进行的场次' : '开启新场次' }}
                </h2>
                <p class="panel-subtitle">
                  {{
                    snapshot?.session?.active ? '确认班级信息并管理本场签到' : '选择班级开始签到'
                  }}
                </p>
              </div>
              <Badge v-if="snapshot?.session?.active" variant="secondary"
                ><span class="session-dot" />进行中</Badge
              >
            </div>
            <template v-if="snapshot?.session?.active">
              <div class="active-session-card">
                <div class="session-card-symbol"><GraduationCap :size="22" /></div>
                <div class="session-card-copy">
                  <strong>{{ snapshot.session.className }}</strong
                  ><span>班级编号 {{ snapshot.session.classId }}</span
                  ><span
                    >开始于 {{ new Date(snapshot.session.startedAt).toLocaleString('zh-CN') }}</span
                  >
                  <span v-if="snapshot.session.lateAt"
                    >迟到时间
                    {{
                      new Date(snapshot.session.lateAt).toLocaleTimeString('zh-CN', {
                        hour: '2-digit',
                        minute: '2-digit'
                      })
                    }}</span
                  >
                </div>
                <Button
                  variant="destructive"
                  class="ml-auto"
                  :disabled="busy"
                  @click="endCurrentSession"
                  >{{ busy ? '正在结束…' : '结束本场签到' }}</Button
                >
              </div>
              <p v-if="snapshot.rosterNotice" class="roster-notice">
                <TriangleAlert :size="15" />
                <span>{{ snapshot.rosterNotice }}</span>
              </p>
              <Button variant="outline" size="sm" :disabled="busy" @click="teacherStore.syncRoster"
                ><RefreshCw :size="14" />手动同步班级名单</Button
              >
            </template>
            <form v-else class="session-form" @submit.prevent="startSelectedSession">
              <div class="session-field">
                <span class="field-label">签到班级</span>
                <ClassPicker
                  v-model="selectedClassId"
                  :classes="classes"
                  :loading="loadingClasses"
                  :disabled="!!runtime?.serverError"
                  aria-label="签到班级"
                />
              </div>
              <div class="session-field">
                <label class="field-label" for="late-time">迟到时间（可选）</label
                ><input
                  id="late-time"
                  v-model="lateTime"
                  type="time"
                  step="60"
                  class="late-time-input"
                /><span class="form-note">超过所设时间的下一秒自动标记迟到</span>
              </div>
              <p v-if="loadingClasses" class="form-note">正在从学校服务加载班级列表…</p>
              <p v-else-if="schoolError" class="form-note text-red-700">
                班级列表加载失败：{{ schoolError }}
                <Button variant="ghost" size="sm" @click.prevent="schoolStore.loadClasses(true)"
                  >重试</Button
                >
              </p>
              <p v-else-if="selectedClass" class="form-note">
                {{ selectedClass.departmentName || '未分学部' }} · 共
                {{ selectedClass.size ?? '—' }} 人，开启后将拉取该班学生名单用于核对。
              </p>
              <Button
                type="submit"
                class="w-fit"
                :disabled="busy || !selectedClass || !!runtime?.serverError"
                >{{ busy ? '正在开启…' : '开启签到场次' }}<ArrowUpRight :size="16"
              /></Button>
            </form>
          </Card>
        </div>

        <div v-else-if="activeSection === 'records'" class="mx-auto max-w-280">
          <div class="mb-5 flex gap-2" role="tablist" aria-label="签到记录范围">
            <Button
              :variant="recordsTab === 'current' ? 'secondary' : 'ghost'"
              role="tab"
              :aria-selected="recordsTab === 'current'"
              @click="recordsTab = 'current'"
              >当前场次</Button
            >
            <Button
              :variant="recordsTab === 'history' ? 'secondary' : 'ghost'"
              role="tab"
              :aria-selected="recordsTab === 'history'"
              @click="recordsTab = 'history'"
              >历史场次</Button
            >
          </div>
          <AttendanceHistory v-if="recordsTab === 'history'" />
          <template v-else>
            <div class="mb-6 flex items-end justify-between gap-5">
              <div>
                <div
                  class="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-primary"
                >
                  <ListChecks :size="14" />签到明细
                </div>
                <h1 class="m-0 text-2xl font-bold tracking-tight">签到记录</h1>
                <p class="mb-0 mt-2 text-sm text-muted-foreground">
                  {{
                    snapshot?.session
                      ? `${snapshot.session.className} · ${snapshot.session.active ? '本场进行中' : '本场已结束'}`
                      : '当前没有场次'
                  }}
                </p>
              </div>
              <div v-if="snapshot?.roster" class="flex flex-wrap items-center justify-end gap-2">
                <Badge variant="outline">应到 {{ rosterStats.total }} 人</Badge>
                <Badge variant="secondary">实到 {{ rosterStats.signed }} 人</Badge>
                <Badge v-if="rosterStats.late" variant="outline"
                  >迟到 {{ rosterStats.late }} 人</Badge
                >
                <Badge variant="outline" class="leave-badge">请假 {{ rosterStats.leave }} 人</Badge>
                <Badge variant="outline" class="absent-badge"
                  >未到 {{ rosterStats.absent }} 人</Badge
                >
                <Button
                  variant="outline"
                  size="sm"
                  :disabled="busy || !snapshot?.session?.active"
                  @click="teacherStore.syncRoster"
                  ><RefreshCw :size="14" />同步名单</Button
                >
                <Button
                  variant="outline"
                  size="sm"
                  :disabled="busy || !snapshot?.session?.active || rosterStats.signed === 0"
                  @click="resetAllCheckins"
                >
                  <RotateCcw :size="14" />全班重新签到
                </Button>
              </div>
            </div>
            <p v-if="snapshot?.rosterNotice" class="roster-notice mb-4">
              <TriangleAlert :size="15" />
              <span>{{ snapshot.rosterNotice }}</span>
            </p>
            <Card class="content-panel overflow-hidden p-0">
              <div v-if="snapshot?.roster" class="overflow-x-auto">
                <table class="w-full border-collapse text-left text-sm">
                  <thead>
                    <tr>
                      <th>序号</th>
                      <th>学生</th>
                      <th>状态</th>
                      <th>签到时间</th>
                      <th>电脑名称</th>
                      <th>身份证</th>
                      <th>标记</th>
                      <th class="w-28">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="(entry, index) in snapshot.roster" :key="entry.studentId">
                      <td class="tabular-nums">{{ index + 1 }}</td>
                      <td>
                        <div class="flex items-center gap-3">
                          <button
                            v-if="entry.avatarUrl"
                            type="button"
                            class="record-avatar record-avatar-button"
                            :aria-label="`预览${entry.studentName}的头像`"
                            @click="openAvatarPreview(entry)"
                          >
                            <img
                              v-if="avatarImages.get(avatarImageKey(entry.avatarUrl, 'thumbnail'))"
                              :src="avatarImages.get(avatarImageKey(entry.avatarUrl, 'thumbnail'))"
                              :alt="`${entry.studentName}的头像`"
                            />
                            <span v-else>{{ entry.studentName.slice(0, 1) }}</span>
                          </button>
                          <span v-else class="record-avatar">
                            {{ entry.studentName.slice(0, 1) }}
                          </span>
                          <strong>{{ entry.studentName }}</strong>
                        </div>
                      </td>
                      <td>
                        <Badge v-if="entry.attendance === 'signed'" variant="secondary"
                          ><Check :size="12" />已签到</Badge
                        >
                        <Badge v-else-if="entry.attendance === 'late'" variant="outline"
                          >迟到</Badge
                        >
                        <Badge
                          v-else-if="entry.attendance === 'leave'"
                          variant="outline"
                          class="leave-badge"
                          ><CalendarOff :size="12" />已请假</Badge
                        >
                        <Badge v-else variant="outline">未签到</Badge>
                      </td>
                      <td class="tabular-nums">
                        {{
                          entry.signedAt ? new Date(entry.signedAt).toLocaleString('zh-CN') : '—'
                        }}
                      </td>
                      <td>{{ entry.stationId ?? '—' }}</td>
                      <td>
                        <button
                          type="button"
                          class="id-card-reveal tabular-nums"
                          :aria-label="`查看${entry.studentName}的完整身份证号码`"
                          @click="showIdCard(entry)"
                        >
                          ****{{ entry.idCardLast4 }} <Eye :size="14" />
                        </button>
                      </td>
                      <td>
                        {{
                          entry.mark === 'withdrawn'
                            ? '退学'
                            : entry.mark === 'other'
                              ? entry.remark
                              : entry.mark === 'leave'
                                ? '请假'
                                : '—'
                        }}
                      </td>
                      <td>
                        <Button
                          v-if="entry.attendance === 'signed' || entry.attendance === 'late'"
                          variant="ghost"
                          size="sm"
                          class="reset-checkin"
                          :disabled="busy || !snapshot?.session?.active"
                          @click="resetEntryCheckin(entry)"
                          >重新签到</Button
                        >
                        <Button variant="ghost" size="sm" :disabled="busy" @click="openMark(entry)"
                          >标记</Button
                        >
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div v-else class="empty-records large-empty">
                {{ snapshot?.session ? '本场次没有名单数据' : '开启场次后显示班级名单与签到状态' }}
              </div>
            </Card>
          </template>
        </div>

        <ConnectionManagement
          v-else-if="activeSection === 'connections'"
          :checkins="snapshot?.checkins ?? []"
          :session-active="Boolean(snapshot?.session?.active)"
        />

        <div v-else-if="activeSection === 'terminal'" class="mx-auto max-w-280">
          <div class="mb-6">
            <div
              class="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-primary"
            >
              <Settings2 :size="14" />运行环境
            </div>
            <h1 class="m-0 text-2xl font-bold tracking-tight">终端信息</h1>
          </div>
          <Card class="content-panel">
            <div class="mb-5 flex items-center gap-3">
              <div class="summary-icon bg-blue-50 text-primary"><Network :size="18" /></div>
              <div>
                <h2 class="panel-title">本机服务</h2>
                <p class="panel-subtitle">学生终端通过局域网连接此地址</p>
              </div>
            </div>
            <dl class="terminal-details">
              <div>
                <dt>服务状态</dt>
                <dd>
                  <Badge :variant="serviceReady ? 'secondary' : 'destructive'">{{
                    runtime?.serverError ? '启动失败' : '运行中'
                  }}</Badge>
                </dd>
              </div>
              <div>
                <dt>学生端访问地址</dt>
                <dd>{{ runtime?.teacherUrl }}</dd>
              </div>
              <div>
                <dt>教师机电脑名称</dt>
                <dd>{{ runtime?.stationId }}</dd>
              </div>
            </dl>
          </Card>
          <Card class="content-panel mt-5">
            <div class="mb-5 flex items-center gap-3">
              <div class="summary-icon bg-blue-50 text-primary"><GraduationCap :size="18" /></div>
              <div>
                <h2 class="panel-title">学校服务</h2>
                <p class="panel-subtitle">班级与学生名单来自学校管理系统</p>
              </div>
            </div>
            <dl class="terminal-details">
              <div>
                <dt>登录状态</dt>
                <dd>
                  <Badge :variant="schoolAuth?.loggedIn ? 'secondary' : 'destructive'">{{
                    schoolAuth?.loggedIn ? '已登录' : '未登录'
                  }}</Badge>
                </dd>
              </div>
              <div>
                <dt>服务地址</dt>
                <dd>{{ runtime?.schoolServerUrl }}</dd>
              </div>
              <div>
                <dt>账号编号</dt>
                <dd>{{ schoolAuth?.userId ?? '—' }}</dd>
              </div>
            </dl>
          </Card>
        </div>

        <div v-else class="mx-auto max-w-280">
          <div class="mb-6">
            <div
              class="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-primary"
            >
              <Settings2 :size="14" />偏好设置
            </div>
            <h1 class="m-0 text-2xl font-bold tracking-tight">设置</h1>
          </div>
          <DeploymentSettings
            v-if="runtime?.appSettings"
            :settings="runtime.appSettings"
            :logo-data-url="runtime.schoolLogoDataUrl"
            :teacher-url="runtime.teacherUrl"
          />
          <Card class="content-panel appearance-card mt-5">
            <div class="mb-5">
              <h2 class="panel-title">主题外观</h2>
              <p class="panel-subtitle">选择适合当前环境的显示主题，设置会自动保存。</p>
            </div>
            <div class="theme-options" role="group" aria-label="选择主题模式">
              <Button
                v-for="option in themeOptions"
                :key="option.mode"
                :variant="themeMode === option.mode ? 'secondary' : 'outline'"
                class="theme-option"
                :aria-pressed="themeMode === option.mode"
                @click="setTheme(option.mode)"
              >
                <component :is="option.icon" :size="20" />
                <span class="theme-option-copy">
                  <strong>{{ option.label }}</strong>
                  <small>{{ option.description }}</small>
                </span>
                <Check v-if="themeMode === option.mode" class="theme-option-check" :size="17" />
              </Button>
            </div>
            <p class="theme-current-label">
              当前显示：{{ preferencesStore.resolvedTheme === 'dark' ? '深色模式' : '浅色模式' }}
            </p>
          </Card>
          <Card class="content-panel mt-5">
            <div class="mb-5 flex items-start justify-between gap-4">
              <div>
                <h2 class="panel-title">学校账号</h2>
                <p class="panel-subtitle">当前登录学校服务的账号，退出后需要重新登录才能签到。</p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                class="account-refresh"
                :disabled="profileLoading"
                @click="schoolStore.loadProfile(true)"
                >{{ profileLoading ? '刷新中…' : '刷新资料' }}</Button
              >
            </div>

            <div v-if="schoolProfile" class="account-profile">
              <div class="account-avatar">
                <img
                  v-if="schoolProfile.avatarUrl"
                  :src="schoolProfile.avatarUrl"
                  :alt="`${schoolProfile.displayName}的头像`"
                />
                <span v-else>{{ profileInitial }}</span>
              </div>
              <div class="account-identity">
                <div class="account-name-row">
                  <strong class="account-name">{{ schoolProfile.displayName }}</strong>
                  <Badge v-for="role in schoolProfile.roleNames" :key="role" variant="secondary">{{
                    role
                  }}</Badge>
                </div>
                <p class="account-account">
                  {{ schoolProfile.userName ? `@${schoolProfile.userName}` : '学校账号已登录' }}
                </p>
              </div>
            </div>
            <p v-else-if="profileLoading" class="profile-note">正在加载学校账号资料…</p>
            <p v-else-if="profileError" class="profile-note profile-note-error">
              账号资料加载失败：{{ profileError }}
            </p>

            <dl class="terminal-details account-details">
              <div>
                <dt>账号编号</dt>
                <dd>{{ schoolProfile?.id ?? schoolAuth?.userId ?? '—' }}</dd>
              </div>
              <div v-if="schoolProfile?.empId != null">
                <dt>员工编号</dt>
                <dd>{{ schoolProfile.empId }}</dd>
              </div>
              <div v-if="schoolProfile?.phoneNumber">
                <dt>手机号</dt>
                <dd>{{ schoolProfile.phoneNumber }}</dd>
              </div>
              <div>
                <dt>服务地址</dt>
                <dd class="break-all">{{ schoolAuth?.serverUrl }}</dd>
              </div>
            </dl>
            <Button variant="destructive" class="mt-5 w-fit" :disabled="busy" @click="logoutSchool"
              ><LogOut :size="15" />退出学校账号</Button
            >
          </Card>
        </div>
      </div>
    </div>
  </main>
</template>

<style scoped>
.teacher-sidebar {
  position: relative;
  z-index: 1;
  width: 248px;
  border-right: 1px solid hsl(var(--border));
  background: hsl(var(--card));
  transition: width 0.2s ease;
}
.teacher-sidebar.is-collapsed {
  width: 76px;
}
.sidebar-brand {
  min-height: 72px;
  gap: 11px;
  border-bottom: 1px solid hsl(var(--border));
  padding: 0 14px;
}
.is-collapsed .sidebar-brand {
  justify-content: center;
  padding: 0 10px;
}
.sidebar-toggle {
  width: 32px;
  height: 32px;
  flex: none;
  padding: 0;
}
.sidebar-section-label {
  padding: 22px 25px 9px;
  color: hsl(var(--muted-foreground));
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
}
.sidebar-nav {
  display: grid;
  gap: 5px;
  padding: 8px 12px;
}
.sidebar-item {
  position: relative;
  display: flex;
  width: 100%;
  min-height: 43px;
  align-items: center;
  justify-content: flex-start;
  gap: 12px;
  padding: 0 13px;
  text-align: left;
}
.sidebar-active-dot {
  width: 5px;
  height: 5px;
  margin-left: auto;
  border-radius: 50%;
  background: currentColor;
}
.is-collapsed .sidebar-nav {
  padding: 14px 11px;
}
.is-collapsed .sidebar-item {
  justify-content: center;
  padding: 0;
}
.sidebar-spacer {
  flex: 1;
}
.sidebar-status {
  display: flex;
  min-height: 68px;
  align-items: center;
  gap: 11px;
  border-top: 1px solid hsl(var(--border));
  padding: 12px 15px;
}
.sidebar-status-collapsed {
  justify-content: center;
  padding: 12px 8px;
}
.sidebar-status-icon {
  display: grid;
  width: 34px;
  height: 34px;
  flex: none;
  place-items: center;
  border-radius: 10px;
}
.sidebar-status-icon.is-online {
  background: #eaf8ef;
  color: #25965b;
}
.sidebar-status-icon.is-offline {
  background: #fff0f0;
  color: #d64747;
}
.teacher-main {
  overflow: hidden;
}
.teacher-menubar {
  -webkit-app-region: drag;
  background: hsl(var(--card));
}
.titlebar-copy,
.titlebar-tools,
.window-controls,
.window-control {
  -webkit-app-region: no-drag;
}
.today-label {
  color: hsl(var(--muted-foreground));
  font-size: 12px;
}
.window-control {
  width: 38px;
  height: 34px;
  padding: 0;
}
.theme-options {
  display: grid;
  max-width: 660px;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}
.theme-option {
  min-height: 82px;
  justify-content: flex-start;
  gap: 13px;
  padding: 13px 15px;
  text-align: left;
}
.theme-option-copy {
  display: grid;
  flex: 1;
  gap: 5px;
}
.theme-option-copy strong {
  color: inherit;
  font-size: 13px;
}
.theme-option-copy small {
  color: #8291a7;
  font-size: 11px;
  font-weight: 400;
}
.theme-option-check {
  flex: none;
  color: #3478f6;
}
.theme-current-label {
  margin: 17px 0 0;
  color: #8291a7;
  font-size: 12px;
}
.service-chip {
  white-space: nowrap;
}
.service-chip-online {
  background: #e7f5ec;
  color: #18794e;
}
.service-light,
.session-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: currentColor;
}
.service-light-online {
  background: #1a8c54;
}
.service-light-offline {
  background: #d64747;
}
.summary-panel {
  position: relative;
  min-height: 166px;
  padding: 20px 22px;
}
.summary-icon {
  display: grid;
  width: 38px;
  height: 38px;
  place-items: center;
  border-radius: 11px;
}
.summary-label {
  margin: 14px 0 7px;
  color: #7186a4;
  font-size: 12px;
  font-weight: 600;
}
.summary-number {
  color: #17345e;
  font-size: 31px;
  line-height: 1;
}
.summary-name {
  display: block;
  overflow: hidden;
  color: #213455;
  font-size: 18px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.summary-foot {
  overflow: hidden;
  margin: 9px 0 0;
  color: #8297b0;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.content-panel {
  padding: 23px 25px;
}
.panel-title {
  margin: 0;
  color: #213455;
  font-size: 15px;
  font-weight: 700;
}
.panel-subtitle {
  margin: 6px 0 0;
  color: #8291a7;
  font-size: 12px;
}
.session-summary {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 18px;
  border-top: 1px solid #edf1f7;
  padding-top: 18px;
}
.session-summary div {
  display: grid;
  gap: 7px;
}
.session-summary span {
  color: #8291a7;
  font-size: 12px;
}
.session-summary strong {
  color: #213455;
  font-size: 13px;
}
.empty-session {
  display: flex;
  min-height: 68px;
  align-items: center;
  gap: 13px;
  border-top: 1px solid #edf1f7;
  padding-top: 16px;
  color: #7186a4;
  font-size: 13px;
}
.empty-session-mark {
  display: grid;
  width: 38px;
  height: 38px;
  flex: none;
  place-items: center;
  border-radius: 11px;
  background: #f0f5fd;
  color: #6584b0;
}
.empty-records {
  padding: 28px 12px;
  color: #8b9ab0;
  font-size: 13px;
  text-align: center;
}
.large-empty {
  padding: 64px 12px;
}
.record-list {
  display: grid;
}
.record-row {
  display: flex;
  min-height: 62px;
  align-items: center;
  gap: 14px;
  border-top: 1px solid #f0f3f8;
}
.record-avatar {
  display: grid;
  width: 34px;
  height: 34px;
  flex: none;
  place-items: center;
  border-radius: 11px;
  background: #edf4ff;
  color: #3478f6;
  font-size: 13px;
  font-weight: 700;
}
.record-avatar-button {
  overflow: hidden;
  padding: 0;
  border: 0;
  cursor: pointer;
}
.record-avatar-button:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 2px;
}
.record-avatar-button img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.student-avatar-preview {
  display: block;
  width: min(100%, 420px);
  max-height: 70vh;
  margin: 0 auto;
  border-radius: 12px;
  object-fit: contain;
}
.record-person {
  display: grid;
  min-width: 150px;
  flex: 1;
  gap: 4px;
}
.record-person strong {
  color: #263b5d;
  font-size: 13px;
}
.record-person span,
.record-terminal,
.record-time {
  color: #8998ad;
  font-size: 12px;
}
.record-time {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.record-check {
  display: grid;
  width: 23px;
  height: 23px;
  place-items: center;
  border-radius: 50%;
  background: #eaf8ef;
  color: #22a05a;
}
.active-session-card {
  display: flex;
  align-items: center;
  gap: 16px;
  border: 1px solid #e6eef8;
  border-radius: 14px;
  background: #f8fbff;
  padding: 18px;
}
.session-card-symbol {
  display: grid;
  width: 48px;
  height: 48px;
  flex: none;
  place-items: center;
  border-radius: 14px;
  background: #e8f1ff;
  color: #3478f6;
}
.session-card-copy {
  display: grid;
  gap: 5px;
}
.session-card-copy strong {
  color: #213455;
  font-size: 16px;
}
.session-card-copy span {
  color: #8291a7;
  font-size: 12px;
}
.session-form {
  display: grid;
  max-width: 580px;
  gap: 18px;
}
.session-field {
  display: grid;
  gap: 8px;
}
.field-label {
  color: #475b79;
  font-size: 13px;
  font-weight: 600;
}
.field-base {
  width: 100%;
  height: 44px;
  border: 1px solid #d8e3f2;
  border-radius: 10px;
  background: #fff;
  padding: 0 13px;
  color: #213455;
  outline: none;
  transition:
    border 0.15s,
    box-shadow 0.15s;
}
.field-base:focus {
  border-color: #76a3f8;
  box-shadow: 0 0 0 3px #eaf2ff;
}
.form-note {
  margin: -2px 0 0;
  color: #8291a7;
  font-size: 12px;
  line-height: 1.7;
}
.roster-notice {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin: 14px 0 0;
  border: 1px solid rgba(217, 145, 43, 0.4);
  border-radius: 10px;
  background: rgba(217, 145, 43, 0.08);
  padding: 11px 14px;
  color: #b4741c;
  font-size: 12px;
  line-height: 1.7;
}
.roster-notice svg {
  flex: none;
  margin-top: 2px;
}
table thead {
  background: #f7f9fc;
  color: #72839b;
  font-size: 12px;
}
table th {
  padding: 13px 16px;
  font-weight: 600;
  white-space: nowrap;
}
table td {
  border-top: 1px solid #edf1f7;
  padding: 12px 16px;
  color: #536780;
  white-space: nowrap;
}
table td strong {
  color: #263b5d;
  font-weight: 600;
}
.account-profile {
  display: flex;
  align-items: center;
  gap: 14px;
  border: 1px solid #e6eef8;
  border-radius: 14px;
  background: #f8fbff;
  padding: 16px 18px;
}
.account-avatar {
  display: grid;
  width: 56px;
  height: 56px;
  flex: none;
  place-items: center;
  overflow: hidden;
  border-radius: 50%;
  background: #e8f1ff;
  color: #3478f6;
  font-size: 20px;
  font-weight: 700;
}
.account-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.account-identity {
  display: grid;
  min-width: 0;
  gap: 6px;
}
.account-name-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.account-name {
  color: #213455;
  font-size: 16px;
  font-weight: 700;
}
.account-account {
  margin: 0;
  color: #8291a7;
  font-size: 12px;
  word-break: break-all;
}
.profile-note {
  margin: 0;
  color: #8291a7;
  font-size: 12px;
  line-height: 1.7;
}
.profile-note-error {
  color: #d64747;
}
.account-details {
  margin-top: 8px;
}
.terminal-details {
  display: grid;
  grid-template-columns: 1fr 1fr;
  margin: 0;
}
.terminal-details div {
  display: grid;
  grid-template-columns: 150px minmax(0, 1fr);
  gap: 12px;
  border-top: 1px solid #edf1f7;
  padding: 15px 0;
}
.terminal-details dt {
  color: #8291a7;
  font-size: 13px;
}
.terminal-details dd {
  margin: 0;
  color: #263b5d;
  font-size: 13px;
}
.notice-panel {
  display: flex;
  align-items: flex-start;
  gap: 13px;
  border: 1px solid #dce9fc;
  background: #f6faff;
  padding: 18px 20px;
}
.notice-icon {
  display: grid;
  width: 34px;
  height: 34px;
  flex: none;
  place-items: center;
  border-radius: 10px;
  background: #e6f0ff;
  color: #3478f6;
}
.notice-panel strong {
  color: #294d80;
  font-size: 13px;
}
.notice-panel p {
  margin: 6px 0 0;
  color: #7186a4;
  font-size: 12px;
  line-height: 1.7;
}
.theme-dark .sidebar-status-icon.is-online {
  background: #29362f;
  color: #74d6a0;
}
.theme-dark .service-chip-online {
  background: #243b2d;
  color: #79d99d;
}
.theme-dark .service-light-online {
  background: #79d99d;
}
.theme-dark .sidebar-status-icon.is-offline {
  background: #3c2b2d;
  color: #ff9b9b;
}
.theme-dark .sidebar-section-label,
.theme-dark .today-label,
.theme-dark .summary-label,
.theme-dark .summary-foot,
.theme-dark .panel-subtitle,
.theme-dark .record-person span,
.theme-dark .record-terminal,
.theme-dark .record-time,
.theme-dark .empty-records,
.theme-dark .session-summary span,
.theme-dark .session-card-copy span,
.theme-dark .form-note,
.theme-dark .terminal-details dt,
.theme-dark .notice-panel p,
.theme-dark .theme-current-label,
.theme-dark .theme-option-copy small {
  color: #a7a9ad;
}
.theme-dark .summary-number,
.theme-dark .summary-name,
.theme-dark .panel-title,
.theme-dark .session-summary strong,
.theme-dark .record-person strong,
.theme-dark .session-card-copy strong,
.theme-dark table td,
.theme-dark table td strong,
.theme-dark .terminal-details dd {
  color: #eff0f2;
}
.theme-dark .session-summary,
.theme-dark .empty-session,
.theme-dark .record-row,
.theme-dark .terminal-details div {
  border-color: #393b3f;
}
.theme-dark .empty-session-mark,
.theme-dark .record-avatar {
  background: #383c40;
  color: #d8dde2;
}
.theme-dark .active-session-card,
.theme-dark .account-profile {
  border-color: #414347;
  background: #292b2e;
}
.theme-dark .account-avatar {
  background: #3d4145;
  color: #d8dde2;
}
.theme-dark .account-name {
  color: #eff0f2;
}
.theme-dark .account-account,
.theme-dark .profile-note {
  color: #a7a9ad;
}
.theme-dark .profile-note-error {
  color: #ff9b9b;
}
.theme-dark .session-card-symbol {
  background: #3d4145;
  color: #d8dde2;
}
.theme-dark .field-base {
  border-color: #4a4c4f;
  background: #202123;
  color: #eff0f2;
}
.theme-dark .field-label {
  color: #d0d2d5;
}
.theme-dark table thead {
  background: #292b2e;
  color: #b7b8ba;
}
.theme-dark table td {
  border-color: #393b3f;
}
.theme-dark .notice-panel {
  border-color: #414346;
  background: #2a2c2f;
}
.theme-dark .notice-panel strong {
  color: #e0e2e4;
}
.theme-dark .notice-icon {
  background: #3d4145;
  color: #d8dde2;
}
.theme-dark .theme-option-check {
  color: #d8dde2;
}
@media (max-width: 900px) {
  .teacher-sidebar {
    width: 210px;
  }
  .teacher-sidebar.is-collapsed {
    width: 68px;
  }
  .teacher-content {
    padding: 22px 18px;
  }
  .teacher-menubar {
    padding-right: 12px;
    padding-left: 16px;
  }
  .service-chip {
    display: none;
  }
  .terminal-details {
    grid-template-columns: 1fr;
  }
}
@media (max-width: 640px) {
  .teacher-sidebar {
    width: 68px;
  }
  .teacher-sidebar.is-expanded {
    width: 68px;
  }
  .teacher-sidebar.is-expanded .sidebar-brand {
    justify-content: center;
    padding: 0 8px;
  }
  .teacher-sidebar.is-expanded .sidebar-brand > div:nth-child(2),
  .teacher-sidebar.is-expanded .sidebar-section-label,
  .teacher-sidebar.is-expanded .sidebar-item span,
  .teacher-sidebar.is-expanded .sidebar-status > div {
    display: none;
  }
  .teacher-sidebar.is-expanded .sidebar-nav {
    padding: 14px 8px;
  }
  .teacher-sidebar.is-expanded .sidebar-item {
    justify-content: center;
    padding: 0;
  }
  .teacher-sidebar.is-expanded .sidebar-toggle {
    position: absolute;
    top: 48px;
    right: 2px;
    z-index: 2;
    width: 25px;
    height: 25px;
  }
  .teacher-menubar {
    padding-right: 7px;
    padding-left: 12px;
  }
  .today-label {
    display: none;
  }
  .theme-options {
    grid-template-columns: 1fr;
  }
  .session-summary {
    grid-template-columns: 1fr;
  }
  .active-session-card {
    align-items: flex-start;
    flex-wrap: wrap;
  }
  .active-session-card button {
    margin-left: 64px;
  }
  .record-terminal {
    display: none;
  }
}

.leave-badge {
  border-color: rgba(217, 145, 43, 0.45);
  color: #b4741c;
  background: rgba(217, 145, 43, 0.08);
}

.absent-badge {
  color: hsl(var(--muted-foreground));
}

.leave-toggle {
  color: #b4741c;
}

.reset-checkin {
  color: #3478f6;
}

:global(:root[data-theme='dark']) .leave-badge {
  color: #f4ce78;
  background: rgba(217, 145, 43, 0.14);
}

:global(:root[data-theme='dark']) .leave-toggle {
  color: #f4ce78;
}

:global(:root[data-theme='dark']) .reset-checkin {
  color: #8ab4ff;
}

:global(:root[data-theme='dark']) .roster-notice {
  border-color: rgba(217, 145, 43, 0.45);
  background: rgba(217, 145, 43, 0.14);
  color: #f4ce78;
}
.late-time-input,
.mark-form input,
.mark-form select {
  min-height: 38px;
  padding: 0 10px;
  border: 1px solid hsl(var(--border));
  border-radius: 8px;
  background: hsl(var(--background));
  color: hsl(var(--foreground));
}
.mark-form {
  display: grid;
  gap: 16px;
}
.mark-form label {
  display: grid;
  gap: 7px;
  font-size: 13px;
  font-weight: 600;
}
.mark-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.full-id-card {
  margin: 0;
  padding: 16px;
  border-radius: 9px;
  background: hsl(var(--secondary));
  font-size: 19px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-align: center;
  user-select: text;
  overflow-wrap: anywhere;
}
.id-card-reveal {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 7px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: hsl(var(--primary));
  cursor: pointer;
}
.id-card-reveal:focus-visible {
  outline: 2px solid hsl(var(--ring));
}
</style>
