<script setup lang="ts">
import { computed, onMounted, onUnmounted, shallowRef, watch } from 'vue'
import { Clock3, Expand, MapPin, Monitor, Pencil, RefreshCw, UserRound, WifiOff } from '@lucide/vue'
import type {
  CheckinRecord,
  ConnectedTerminal,
  TerminalScreenFrame,
  TerminalSeatAssignments
} from '../../../shared/contracts'
import Button from './ui/button/Button.vue'
import Dialog from './ui/dialog/Dialog.vue'

const props = defineProps<{ checkins: CheckinRecord[]; sessionActive: boolean }>()
const terminals = shallowRef<ConnectedTerminal[]>([])
const seats = shallowRef<TerminalSeatAssignments>({})
const loading = shallowRef(true)
const error = shallowRef('')
const activeFilter = shallowRef<'all' | 'offline' | 'unsigned' | 'signed'>('all')
const editingStationId = shallowRef<string | null>(null)
const seatDraft = shallowRef('')
const seatError = shallowRef('')
const savingSeat = shallowRef(false)
const previewStationId = shallowRef<string | null>(null)
const previewFrame = shallowRef<TerminalScreenFrame | null>(null)
const previewLoading = shallowRef(false)
const preview = computed(
  () => terminals.value.find((item) => item.stationId === previewStationId.value) ?? null
)
const previewOpen = computed({
  get: () => previewStationId.value !== null && preview.value !== null,
  set: (open: boolean) => {
    if (!open) previewStationId.value = null
  }
})
const signedByStation = computed(() => {
  const result = new Map<string, CheckinRecord[]>()
  for (const record of props.checkins) {
    const entries = result.get(record.stationId) ?? []
    entries.push(record)
    result.set(record.stationId, entries)
  }
  return result
})
interface TerminalCard extends ConnectedTerminal {
  online: boolean
  seatLabel: string
  students: CheckinRecord[]
}
const cards = computed<TerminalCard[]>(() => {
  const online = new Map(terminals.value.map((terminal) => [terminal.stationId, terminal]))
  const stationIds = new Set([...online.keys(), ...Object.keys(seats.value)])
  return [...stationIds]
    .map((stationId) => ({
      ...(online.get(stationId) ?? { stationId, lastSeenAt: '' }),
      online: online.has(stationId),
      seatLabel: seats.value[stationId] ?? '',
      students: signedByStation.value.get(stationId) ?? []
    }))
    .sort((a, b) => {
      if (a.seatLabel && !b.seatLabel) return -1
      if (!a.seatLabel && b.seatLabel) return 1
      return (a.seatLabel || a.stationId).localeCompare(b.seatLabel || b.stationId, 'zh-CN', {
        numeric: true
      })
    })
})
const counts = computed(() => ({
  all: cards.value.length,
  offline: cards.value.filter((card) => !card.online).length,
  unsigned: props.sessionActive
    ? cards.value.filter((card) => card.online && !card.students.length).length
    : 0,
  signed: cards.value.filter((card) => card.students.length > 0).length
}))
const visibleCards = computed(() => {
  if (activeFilter.value === 'offline') return cards.value.filter((card) => !card.online)
  if (activeFilter.value === 'unsigned')
    return cards.value.filter((card) => card.online && props.sessionActive && !card.students.length)
  if (activeFilter.value === 'signed') return cards.value.filter((card) => card.students.length > 0)
  return cards.value
})
const filterOptions = [
  { id: 'all', label: '全部机器' },
  { id: 'offline', label: '离线' },
  { id: 'unsigned', label: '未签到' },
  { id: 'signed', label: '已签到' }
] as const
const seatDialogOpen = computed({
  get: () => editingStationId.value !== null,
  set: (open: boolean) => {
    if (!open) editingStationId.value = null
  }
})
watch(previewStationId, () => {
  previewFrame.value = null
})
watch(
  [previewStationId, () => preview.value?.screenCapturedAt],
  async ([stationId], _previous, onCleanup) => {
    if (!stationId) {
      return
    }
    let current = true
    onCleanup(() => {
      current = false
    })
    previewLoading.value = true
    try {
      const frame = await window.signIn.getTerminalScreen(stationId)
      if (current) previewFrame.value = frame
    } catch (cause) {
      if (current) error.value = cause instanceof Error ? cause.message : '读取放大画面失败'
    } finally {
      if (current) previewLoading.value = false
    }
  }
)
let timer: ReturnType<typeof setInterval> | undefined
let refreshing = false

async function refresh(): Promise<void> {
  if (refreshing) return
  refreshing = true
  try {
    const [terminalResult, seatResult] = await Promise.allSettled([
      window.signIn.getConnectedTerminals(),
      window.signIn.getTerminalSeats()
    ])
    if (terminalResult.status === 'fulfilled') terminals.value = terminalResult.value
    if (seatResult.status === 'fulfilled') seats.value = seatResult.value
    const failures = [terminalResult, seatResult]
      .filter((result) => result.status === 'rejected')
      .map((result) =>
        result.reason instanceof Error ? result.reason.message : '读取连接信息失败'
      )
    error.value = failures.join('；')
  } finally {
    loading.value = false
    refreshing = false
  }
}

function editSeat(card: TerminalCard): void {
  editingStationId.value = card.stationId
  seatDraft.value = card.seatLabel
  seatError.value = ''
}

async function saveSeat(): Promise<void> {
  if (!editingStationId.value || savingSeat.value) return
  savingSeat.value = true
  seatError.value = ''
  try {
    seats.value = await window.signIn.setTerminalSeat(editingStationId.value, seatDraft.value)
    editingStationId.value = null
  } catch (cause) {
    seatError.value = cause instanceof Error ? cause.message : '保存座位失败'
  } finally {
    savingSeat.value = false
  }
}

function timeLabel(value: string): string {
  return new Date(value).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

onMounted(() => {
  void refresh()
  timer = setInterval(() => void refresh(), 3000)
})
onUnmounted(() => {
  if (timer) clearInterval(timer)
})
</script>

<template>
  <section class="connections-page" aria-labelledby="connections-title">
    <header class="connections-heading">
      <div>
        <p class="connections-kicker">机房运行状态</p>
        <h1 id="connections-title">连接管理</h1>
        <p class="connections-description">按座位查看学生机、当前画面与本场次签到状态。</p>
      </div>
      <div class="connections-actions">
        <span class="connections-count"
          ><span class="online-dot" />{{ terminals.length }} 台在线</span
        >
        <Button variant="outline" size="sm" :disabled="loading" @click="refresh">
          <RefreshCw :size="15" />刷新
        </Button>
      </div>
    </header>

    <nav class="connection-filters" aria-label="连接状态筛选">
      <button
        v-for="option in filterOptions"
        :key="option.id"
        type="button"
        :class="['filter-button', { 'is-selected': activeFilter === option.id }]"
        :aria-pressed="activeFilter === option.id"
        @click="activeFilter = option.id"
      >
        {{ option.label }} <span>{{ counts[option.id] }}</span>
      </button>
    </nav>
    <p v-if="!sessionActive" class="filter-note">未签到统计会在开启签到场次后显示。</p>

    <p v-if="error" class="connections-error" role="alert">{{ error }}</p>
    <div v-if="loading" class="connections-empty" role="status">正在读取终端连接…</div>
    <div v-else-if="!cards.length" class="connections-empty">
      <span class="empty-icon"><WifiOff :size="26" :stroke-width="1.6" /></span>
      <h2>还没有学生机</h2>
      <p>学生端连接到教师机后会自动出现。为机器设置座位号后，离线时也会保留在这里。</p>
    </div>
    <div v-else-if="!visibleCards.length" class="connections-empty">
      <span class="empty-icon"><Monitor :size="26" :stroke-width="1.6" /></span>
      <h2>当前筛选没有机器</h2>
      <p>
        {{
          activeFilter === 'unsigned' && !sessionActive
            ? '开启签到场次后才能查看未签到机器。'
            : '试试切换其他状态。'
        }}
      </p>
    </div>
    <div v-else class="terminal-grid">
      <article
        v-for="terminal in visibleCards"
        :key="terminal.stationId"
        class="terminal-card"
        :class="{ 'is-offline': !terminal.online }"
      >
        <div class="terminal-card-heading">
          <div class="terminal-identity">
            <strong class="seat-name">{{ terminal.seatLabel || '未设置座位' }}</strong>
            <span class="terminal-name"><Monitor :size="14" />{{ terminal.stationId }}</span>
          </div>
          <span :class="terminal.online ? 'terminal-online' : 'terminal-offline'"
            ><span class="online-dot" />{{ terminal.online ? '在线' : '离线' }}</span
          >
        </div>
        <div class="terminal-screen">
          <img
            v-if="terminal.online && terminal.screenThumbnailDataUrl"
            :src="terminal.screenThumbnailDataUrl"
            :alt="`${terminal.stationId} 的当前画面`"
          />
          <div v-else class="screen-unavailable">
            <Monitor :size="30" :stroke-width="1.4" /><span>{{
              terminal.online ? '画面暂不可用' : '机器已离线'
            }}</span>
          </div>
          <button
            v-if="terminal.online && terminal.screenThumbnailDataUrl"
            type="button"
            class="screen-expand"
            :aria-label="`放大查看 ${terminal.stationId} 的画面`"
            @click="previewStationId = terminal.stationId"
          >
            <Expand :size="16" />放大画面
          </button>
        </div>
        <div class="terminal-meta">
          <Clock3 :size="13" />{{
            terminal.online
              ? `画面更新于 ${terminal.screenCapturedAt ? timeLabel(terminal.screenCapturedAt) : '—'}`
              : '等待学生端重新连接'
          }}
        </div>
        <div class="terminal-version">
          {{
            terminal.online ? (terminal.clientType === 'browser' ? '网页端' : '学生端') : '学生端'
          }}
          {{
            terminal.online
              ? terminal.appVersion
                ? `v${terminal.appVersion}`
                : '版本未知'
              : '离线'
          }}<button type="button" @click="editSeat(terminal)"><Pencil :size="12" />设置座位</button>
        </div>
        <div class="terminal-students">
          <div class="students-title">
            <UserRound :size="15" />本场签到
            <span>{{ terminal.students.length }} 人</span>
          </div>
          <div v-if="terminal.students.length" class="student-list">
            <div v-for="student in terminal.students" :key="student.studentId" class="student-row">
              <div>
                <strong>{{ student.studentName }}</strong
                ><span>{{ student.studentId }}</span>
              </div>
              <time :datetime="student.signedAt">{{ timeLabel(student.signedAt) }}</time>
            </div>
          </div>
          <p v-else class="student-empty">
            {{ sessionActive ? '这台机器暂无学生签到' : '开启场次后显示签到学生' }}
          </p>
        </div>
      </article>
    </div>

    <Dialog
      v-model:open="previewOpen"
      :title="preview ? `${preview.stationId} 的画面` : '终端画面'"
      description="高分辨率画面约每 9 秒更新一次"
      wide
    >
      <div v-if="previewLoading && !previewFrame" class="preview-loading" role="status">
        正在读取高分辨率画面…
      </div>
      <img
        v-else-if="previewFrame"
        class="preview-image"
        :src="previewFrame.dataUrl"
        :alt="`${preview?.stationId ?? '终端'} 的放大画面`"
      />
      <img
        v-else-if="preview?.screenThumbnailDataUrl"
        class="preview-image"
        :src="preview.screenThumbnailDataUrl"
        :alt="`${preview.stationId} 的画面缩略图`"
      />
    </Dialog>
    <Dialog
      v-model:open="seatDialogOpen"
      :title="`设置 ${editingStationId ?? ''} 的座位`"
      description="座位号保存在教师机，断线后仍可用于定位机器。"
    >
      <form class="seat-form" @submit.prevent="saveSeat">
        <label for="seat-label"><MapPin :size="15" />座位号</label>
        <input
          id="seat-label"
          v-model="seatDraft"
          maxlength="24"
          placeholder="例如 A01、第一排 1 号"
          autocomplete="off"
        />
        <p class="seat-form-help">清空座位号并保存，可取消绑定。</p>
        <p v-if="seatError" class="seat-form-error" role="alert">{{ seatError }}</p>
        <div class="seat-form-actions">
          <Button type="button" variant="ghost" @click="seatDialogOpen = false">取消</Button
          ><Button type="submit" :disabled="savingSeat">{{
            savingSeat ? '保存中…' : '保存座位'
          }}</Button>
        </div>
      </form>
    </Dialog>
  </section>
</template>

<style scoped>
.connections-page {
  max-width: 1440px;
  margin: 0 auto;
}
.connections-heading {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 24px;
  margin-bottom: 28px;
}
.connections-kicker {
  margin: 0 0 7px;
  color: hsl(var(--muted-foreground));
  font-size: 12px;
  font-weight: 600;
}
.connections-heading h1 {
  margin: 0;
  font-size: 28px;
  font-weight: 750;
  letter-spacing: -0.035em;
}
.connections-description {
  margin: 9px 0 0;
  color: hsl(var(--muted-foreground));
  font-size: 13px;
}
.connection-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 18px;
  border-bottom: 1px solid hsl(var(--border));
  padding-bottom: 12px;
}
.filter-button {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  border-radius: 8px;
  padding: 8px 11px;
  color: hsl(var(--muted-foreground));
  font-size: 12px;
  font-weight: 600;
}
.filter-button span {
  min-width: 18px;
  border-radius: 5px;
  background: hsl(var(--muted));
  padding: 1px 4px;
  font-size: 11px;
  text-align: center;
}
.filter-button:hover,
.filter-button.is-selected {
  background: hsl(var(--secondary));
  color: hsl(var(--foreground));
}
.filter-button:focus-visible,
.terminal-version button:focus-visible {
  outline: 2px solid hsl(var(--ring));
  outline-offset: 2px;
}
.filter-note {
  margin: -8px 0 18px;
  color: hsl(var(--muted-foreground));
  font-size: 11px;
}
.connections-actions {
  display: flex;
  align-items: center;
  gap: 15px;
  flex: none;
}
.connections-actions button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.connections-count {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: hsl(var(--foreground));
  font-size: 13px;
  font-weight: 650;
  white-space: nowrap;
}
.online-dot {
  width: 7px;
  height: 7px;
  flex: none;
  border-radius: 50%;
  background: #22a66a;
  box-shadow: 0 0 0 3px rgb(34 166 106 / 0.12);
}
.connections-error {
  margin: 0 0 16px;
  border: 1px solid hsl(var(--destructive) / 0.28);
  border-radius: 10px;
  padding: 11px 14px;
  color: hsl(var(--destructive));
  font-size: 13px;
}
.connections-empty {
  display: flex;
  min-height: 340px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  border: 1px dashed hsl(var(--border));
  border-radius: 16px;
  background: hsl(var(--card));
  padding: 32px;
  text-align: center;
  color: hsl(var(--muted-foreground));
  font-size: 13px;
}
.connections-empty h2 {
  margin: 16px 0 6px;
  color: hsl(var(--foreground));
  font-size: 17px;
}
.connections-empty p {
  max-width: 380px;
  margin: 0;
  line-height: 1.7;
}
.empty-icon {
  display: grid;
  width: 54px;
  height: 54px;
  place-items: center;
  border-radius: 15px;
  background: hsl(var(--muted));
}
.terminal-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 310px), 1fr));
  align-items: start;
  gap: 20px;
}
.terminal-card {
  min-width: 0;
  overflow: hidden;
  border: 1px solid hsl(var(--border));
  border-radius: 15px;
  background: hsl(var(--card));
  box-shadow: 0 8px 24px rgb(21 38 65 / 0.035);
}
.terminal-card.is-offline {
  border-style: dashed;
}
.terminal-card-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 16px 17px 14px;
}
.terminal-identity {
  display: grid;
  min-width: 0;
  gap: 5px;
}
.seat-name {
  overflow: hidden;
  color: hsl(var(--foreground));
  font-size: 16px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.terminal-name {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 9px;
  color: hsl(var(--muted-foreground));
  font-size: 11px;
}
.terminal-name svg {
  flex: none;
  color: hsl(var(--muted-foreground));
}
.terminal-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.terminal-online {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  color: #248455;
  font-size: 11px;
  font-weight: 650;
}
.terminal-offline {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  color: hsl(var(--muted-foreground));
  font-size: 11px;
  font-weight: 650;
}
.terminal-offline .online-dot {
  background: #9aa6b5;
  box-shadow: 0 0 0 3px rgb(154 166 181 / 0.14);
}
.terminal-screen {
  position: relative;
  aspect-ratio: 16 / 9;
  overflow: hidden;
  background: #171d25;
}
.terminal-screen img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.screen-unavailable {
  display: flex;
  width: 100%;
  height: 100%;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: #aab4c0;
  font-size: 12px;
}
.screen-expand {
  position: absolute;
  right: 10px;
  bottom: 10px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border-radius: 8px;
  background: rgb(15 20 27 / 0.82);
  padding: 7px 9px;
  color: white;
  font-size: 11px;
  opacity: 0;
  transition: opacity 0.15s;
}
.terminal-screen:hover .screen-expand,
.screen-expand:focus-visible {
  opacity: 1;
}
.screen-expand:focus-visible {
  outline: 2px solid white;
  outline-offset: -2px;
}
.terminal-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 17px;
  color: hsl(var(--muted-foreground));
  font-size: 11px;
}
.terminal-version {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  border-bottom: 1px solid hsl(var(--border));
  padding: 0 17px 11px;
  color: hsl(var(--muted-foreground));
  font-size: 11px;
}
.terminal-version button {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border-radius: 5px;
  padding: 3px 4px;
  color: hsl(var(--primary));
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
}
.terminal-version button:hover {
  background: hsl(var(--secondary));
}
.terminal-students {
  padding: 14px 17px 17px;
}
.students-title {
  display: flex;
  align-items: center;
  gap: 7px;
  color: hsl(var(--muted-foreground));
  font-size: 12px;
  font-weight: 600;
}
.students-title span {
  margin-left: auto;
  color: hsl(var(--foreground));
}
.student-list {
  display: grid;
  gap: 10px;
  margin-top: 14px;
}
.student-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.student-row > div {
  display: flex;
  min-width: 0;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 5px 9px;
}
.student-row strong {
  color: hsl(var(--foreground));
  font-size: 13px;
}
.student-row span,
.student-row time,
.student-empty {
  color: hsl(var(--muted-foreground));
  font-size: 11px;
}
.student-row time {
  flex: none;
}
.student-empty {
  margin: 13px 0 0;
}
.preview-image {
  display: block;
  width: 100%;
  max-height: calc(100vh - 150px);
  border-radius: 8px;
  background: #171d25;
  object-fit: contain;
}
.preview-loading {
  display: grid;
  min-height: 240px;
  place-items: center;
  border-radius: 8px;
  background: hsl(var(--muted));
  color: hsl(var(--muted-foreground));
  font-size: 13px;
}
.seat-form {
  display: grid;
  gap: 10px;
}
.seat-form label {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 13px;
  font-weight: 650;
}
.seat-form input {
  width: 100%;
  height: 42px;
  border: 1px solid hsl(var(--border));
  border-radius: 9px;
  background: hsl(var(--background));
  padding: 0 12px;
  color: hsl(var(--foreground));
  font-size: 13px;
}
.seat-form input:focus-visible {
  outline: 2px solid hsl(var(--ring));
  outline-offset: 1px;
}
.seat-form-help {
  margin: 0;
  color: hsl(var(--muted-foreground));
  font-size: 11px;
}
.seat-form-error {
  margin: 0;
  color: hsl(var(--destructive));
  font-size: 12px;
}
.seat-form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 12px;
}
@media (max-width: 640px) {
  .connections-heading {
    align-items: start;
    flex-direction: column;
    gap: 16px;
  }
  .connections-heading h1 {
    font-size: 24px;
  }
  .screen-expand {
    opacity: 1;
  }
}
@media (hover: none) {
  .screen-expand {
    opacity: 1;
  }
}
@media (prefers-reduced-motion: reduce) {
  .screen-expand {
    transition: none;
  }
}
</style>
