<script setup lang="ts">
import { computed, onMounted, onUnmounted, shallowRef } from 'vue'
import { Clock3, Expand, Monitor, RefreshCw, UserRound, WifiOff } from '@lucide/vue'
import type { CheckinRecord, ConnectedTerminal } from '../../../shared/contracts'
import Button from './ui/button/Button.vue'
import Dialog from './ui/dialog/Dialog.vue'

const props = defineProps<{ checkins: CheckinRecord[]; sessionActive: boolean }>()
const terminals = shallowRef<ConnectedTerminal[]>([])
const loading = shallowRef(true)
const error = shallowRef('')
const preview = shallowRef<ConnectedTerminal | null>(null)
const previewOpen = computed({
  get: () => preview.value !== null,
  set: (open: boolean) => {
    if (!open) preview.value = null
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
let timer: ReturnType<typeof setInterval> | undefined
let refreshing = false

async function refresh(): Promise<void> {
  if (refreshing) return
  refreshing = true
  try {
    terminals.value = await window.signIn.getConnectedTerminals()
    error.value = ''
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '无法读取终端连接'
  } finally {
    loading.value = false
    refreshing = false
  }
}

function signedStudents(stationId: string): CheckinRecord[] {
  return signedByStation.value.get(stationId) ?? []
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
        <p class="connections-description">查看当前在线的学生机画面和本场次签到情况。</p>
      </div>
      <div class="connections-actions">
        <span class="connections-count"><span class="online-dot" />{{ terminals.length }} 台在线</span>
        <Button variant="outline" size="sm" :disabled="loading" @click="refresh">
          <RefreshCw :size="15" />刷新
        </Button>
      </div>
    </header>

    <p v-if="error" class="connections-error" role="alert">{{ error }}</p>
    <div v-if="loading" class="connections-empty" role="status">正在读取终端连接…</div>
    <div v-else-if="!terminals.length" class="connections-empty">
      <span class="empty-icon"><WifiOff :size="26" :stroke-width="1.6" /></span>
      <h2>暂无在线学生机</h2>
      <p>学生端连接到教师机后，会自动出现在这里。请确认学生端正在运行且处于同一局域网。</p>
    </div>
    <div v-else class="terminal-grid">
      <article v-for="terminal in terminals" :key="terminal.stationId" class="terminal-card">
        <div class="terminal-card-heading">
          <div class="terminal-name"><Monitor :size="17" /><strong>{{ terminal.stationId }}</strong></div>
          <span class="terminal-online"><span class="online-dot" />在线</span>
        </div>
        <div class="terminal-screen">
          <img v-if="terminal.screenDataUrl" :src="terminal.screenDataUrl" :alt="`${terminal.stationId} 的当前画面`" />
          <div v-else class="screen-unavailable"><Monitor :size="30" :stroke-width="1.4" /><span>画面暂不可用</span></div>
          <button
            v-if="terminal.screenDataUrl"
            type="button"
            class="screen-expand"
            :aria-label="`放大查看 ${terminal.stationId} 的画面`"
            @click="preview = terminal"
          ><Expand :size="16" />放大画面</button>
        </div>
        <div class="terminal-meta"><Clock3 :size="13" />画面更新于 {{ terminal.screenCapturedAt ? timeLabel(terminal.screenCapturedAt) : '—' }}</div>
        <div class="terminal-students">
          <div class="students-title"><UserRound :size="15" />本场签到 <span>{{ signedStudents(terminal.stationId).length }} 人</span></div>
          <div v-if="signedStudents(terminal.stationId).length" class="student-list">
            <div v-for="student in signedStudents(terminal.stationId)" :key="student.studentId" class="student-row">
              <div><strong>{{ student.studentName }}</strong><span>{{ student.studentId }}</span></div>
              <time :datetime="student.signedAt">{{ timeLabel(student.signedAt) }}</time>
            </div>
          </div>
          <p v-else class="student-empty">{{ sessionActive ? '这台机器暂无学生签到' : '开启场次后显示签到学生' }}</p>
        </div>
      </article>
    </div>

    <Dialog v-model:open="previewOpen" :title="preview ? `${preview.stationId} 的画面` : '终端画面'" description="画面约每 9 秒更新一次" wide>
      <img v-if="preview?.screenDataUrl" class="preview-image" :src="preview.screenDataUrl" :alt="`${preview.stationId} 的放大画面`" />
    </Dialog>
  </section>
</template>

<style scoped>
.connections-page { max-width: 1440px; margin: 0 auto; }
.connections-heading { display: flex; align-items: end; justify-content: space-between; gap: 24px; margin-bottom: 28px; }
.connections-kicker { margin: 0 0 7px; color: hsl(var(--muted-foreground)); font-size: 12px; font-weight: 600; }
.connections-heading h1 { margin: 0; font-size: 28px; font-weight: 750; letter-spacing: -0.035em; }
.connections-description { margin: 9px 0 0; color: hsl(var(--muted-foreground)); font-size: 13px; }
.connections-actions { display: flex; align-items: center; gap: 15px; flex: none; }
.connections-actions button { display: inline-flex; align-items: center; gap: 6px; }
.connections-count { display: inline-flex; align-items: center; gap: 8px; color: hsl(var(--foreground)); font-size: 13px; font-weight: 650; white-space: nowrap; }
.online-dot { width: 7px; height: 7px; flex: none; border-radius: 50%; background: #22a66a; box-shadow: 0 0 0 3px rgb(34 166 106 / .12); }
.connections-error { margin: 0 0 16px; border: 1px solid hsl(var(--destructive) / .28); border-radius: 10px; padding: 11px 14px; color: hsl(var(--destructive)); font-size: 13px; }
.connections-empty { display: flex; min-height: 340px; flex-direction: column; align-items: center; justify-content: center; border: 1px dashed hsl(var(--border)); border-radius: 16px; background: hsl(var(--card)); padding: 32px; text-align: center; color: hsl(var(--muted-foreground)); font-size: 13px; }
.connections-empty h2 { margin: 16px 0 6px; color: hsl(var(--foreground)); font-size: 17px; }
.connections-empty p { max-width: 380px; margin: 0; line-height: 1.7; }
.empty-icon { display: grid; width: 54px; height: 54px; place-items: center; border-radius: 15px; background: hsl(var(--muted)); }
.terminal-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 310px), 1fr)); align-items: start; gap: 20px; }
.terminal-card { min-width: 0; overflow: hidden; border: 1px solid hsl(var(--border)); border-radius: 15px; background: hsl(var(--card)); box-shadow: 0 8px 24px rgb(21 38 65 / .035); }
.terminal-card-heading { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 16px 17px 14px; }
.terminal-name { display: flex; min-width: 0; align-items: center; gap: 9px; color: hsl(var(--foreground)); }
.terminal-name svg { flex: none; color: hsl(var(--muted-foreground)); }
.terminal-name strong { overflow: hidden; font-size: 14px; text-overflow: ellipsis; white-space: nowrap; }
.terminal-online { display: inline-flex; align-items: center; gap: 7px; color: #248455; font-size: 11px; font-weight: 650; }
.terminal-screen { position: relative; aspect-ratio: 16 / 9; overflow: hidden; background: #171d25; }
.terminal-screen img { display: block; width: 100%; height: 100%; object-fit: contain; }
.screen-unavailable { display: flex; width: 100%; height: 100%; flex-direction: column; align-items: center; justify-content: center; gap: 10px; color: #aab4c0; font-size: 12px; }
.screen-expand { position: absolute; right: 10px; bottom: 10px; display: inline-flex; align-items: center; gap: 6px; border-radius: 8px; background: rgb(15 20 27 / .82); padding: 7px 9px; color: white; font-size: 11px; opacity: 0; transition: opacity .15s; }
.terminal-screen:hover .screen-expand, .screen-expand:focus-visible { opacity: 1; }
.screen-expand:focus-visible { outline: 2px solid white; outline-offset: -2px; }
.terminal-meta { display: flex; align-items: center; gap: 6px; border-bottom: 1px solid hsl(var(--border)); padding: 10px 17px; color: hsl(var(--muted-foreground)); font-size: 11px; }
.terminal-students { padding: 14px 17px 17px; }
.students-title { display: flex; align-items: center; gap: 7px; color: hsl(var(--muted-foreground)); font-size: 12px; font-weight: 600; }
.students-title span { margin-left: auto; color: hsl(var(--foreground)); }
.student-list { display: grid; gap: 10px; margin-top: 14px; }
.student-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.student-row > div { display: flex; min-width: 0; align-items: baseline; flex-wrap: wrap; gap: 5px 9px; }
.student-row strong { color: hsl(var(--foreground)); font-size: 13px; }
.student-row span, .student-row time, .student-empty { color: hsl(var(--muted-foreground)); font-size: 11px; }
.student-row time { flex: none; }
.student-empty { margin: 13px 0 0; }
.preview-image { display: block; width: 100%; border-radius: 8px; background: #171d25; object-fit: contain; }
@media (max-width: 640px) { .connections-heading { align-items: start; flex-direction: column; gap: 16px; } .connections-heading h1 { font-size: 24px; } .screen-expand { opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .screen-expand { transition: none; } }
</style>
