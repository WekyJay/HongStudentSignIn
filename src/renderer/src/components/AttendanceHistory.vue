<script setup lang="ts">
import { computed, onMounted, shallowRef } from 'vue'
import { CalendarDays, Download, Pencil, Search, Trash2 } from '@lucide/vue'
import type {
  ArchivedEntry,
  ArchivedSessionDetail,
  AttendanceArchivePage,
  AttendanceStatus
} from '../../../shared/contracts'
import type { StudentMark } from '../../../shared/contracts'
import Button from './ui/button/Button.vue'
import Dialog from './ui/dialog/Dialog.vue'

const from = shallowRef('')
const to = shallowRef('')
const keyword = shallowRef('')
const entryKeyword = shallowRef('')
const entryStatus = shallowRef<'all' | AttendanceStatus>('all')
const page = shallowRef(1)
const list = shallowRef<AttendanceArchivePage | null>(null)
const detail = shallowRef<ArchivedSessionDetail | null>(null)
const loading = shallowRef(false)
const saving = shallowRef(false)
const error = shallowRef('')
const notice = shallowRef('')
const editingSession = shallowRef(false)
const classNameDraft = shallowRef('')
const editingStudentId = shallowRef<string | null>(null)
const statusDraft = shallowRef<AttendanceStatus>('absent')
const signedAtDraft = shallowRef('')
const stationDraft = shallowRef('')
const markDraft = shallowRef<'' | StudentMark>('')
const remarkDraft = shallowRef('')

const visibleEntries = computed(() => {
  const term = entryKeyword.value.trim().toLowerCase()
  return (detail.value?.entries ?? []).filter(
    (entry) =>
      (entryStatus.value === 'all' || entry.attendance === entryStatus.value) &&
      (!term ||
        [entry.studentId, entry.studentName, entry.stationId ?? ''].some((value) =>
          value.toLowerCase().includes(term)
        ))
  )
})
const totalPages = computed(() => Math.max(1, Math.ceil((list.value?.total ?? 0) / 20)))

function dateTime(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleString('zh-CN') : '—'
}

function localInput(value?: string): string {
  const date = value ? new Date(value) : new Date()
  const offset = date.getTimezoneOffset() * 60000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

async function loadPage(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    let result = await window.signIn.listArchivedSessions({
      from: from.value,
      to: to.value,
      keyword: keyword.value,
      page: page.value
    })
    if (!result.items.length && result.total > 0 && page.value > 1) {
      page.value = Math.ceil(result.total / result.pageSize)
      result = await window.signIn.listArchivedSessions({
        from: from.value,
        to: to.value,
        keyword: keyword.value,
        page: page.value
      })
    }
    list.value = result
    if (detail.value && !list.value.items.some((item) => item.id === detail.value?.session.id)) {
      detail.value = null
    }
  } catch (cause) {
    error.value = errorMessage(cause)
  } finally {
    loading.value = false
  }
}

function search(): void {
  page.value = 1
  notice.value = ''
  void loadPage()
}

function changePage(next: number): void {
  page.value = next
  void loadPage()
}

async function selectSession(id: string): Promise<void> {
  error.value = ''
  editingSession.value = false
  editingStudentId.value = null
  try {
    detail.value = await window.signIn.getArchivedSession(id)
    classNameDraft.value = detail.value.session.className
  } catch (cause) {
    error.value = errorMessage(cause)
  }
}

async function renameSession(): Promise<void> {
  if (!detail.value) return
  saving.value = true
  error.value = ''
  try {
    detail.value = await window.signIn.updateArchivedSession(
      detail.value.session.id,
      classNameDraft.value
    )
    editingSession.value = false
    await loadPage()
    notice.value = '班级名称已保存'
  } catch (cause) {
    error.value = errorMessage(cause)
  } finally {
    saving.value = false
  }
}

function editEntry(entry: ArchivedEntry): void {
  editingStudentId.value = entry.studentId
  statusDraft.value = entry.attendance
  signedAtDraft.value = localInput(entry.signedAt)
  stationDraft.value = entry.stationId ?? ''
  markDraft.value = entry.mark ?? ''
  remarkDraft.value = entry.remark ?? ''
  error.value = ''
}

function editSession(): void {
  error.value = ''
  editingSession.value = true
}

async function saveEntry(): Promise<void> {
  if (!detail.value || !editingStudentId.value) return
  saving.value = true
  error.value = ''
  try {
    const signedAt =
      statusDraft.value === 'signed' || statusDraft.value === 'late'
        ? new Date(signedAtDraft.value).toISOString()
        : undefined
    detail.value = await window.signIn.updateArchivedEntry(
      detail.value.session.id,
      editingStudentId.value,
      {
        attendance: statusDraft.value,
        signedAt,
        stationId: stationDraft.value,
        mark: markDraft.value || undefined,
        remark: remarkDraft.value
      }
    )
    editingStudentId.value = null
    await loadPage()
    notice.value = '考勤记录已保存'
  } catch (cause) {
    error.value = errorMessage(cause)
  } finally {
    saving.value = false
  }
}

async function deleteEntry(entry: ArchivedEntry): Promise<void> {
  if (
    !detail.value ||
    !window.confirm(`删除 ${entry.studentName} 的历史记录？删除后该场次应到人数会减少。`)
  )
    return
  saving.value = true
  error.value = ''
  try {
    detail.value = await window.signIn.deleteArchivedEntry(detail.value.session.id, entry.studentId)
    editingStudentId.value = null
    await loadPage()
    notice.value = '学生记录已删除'
  } catch (cause) {
    error.value = errorMessage(cause)
  } finally {
    saving.value = false
  }
}

async function deleteSession(): Promise<void> {
  if (
    !detail.value ||
    !window.confirm(
      `删除“${detail.value.session.className}”整个历史场次及全部学生记录？此操作无法撤销。`
    )
  )
    return
  saving.value = true
  error.value = ''
  try {
    await window.signIn.deleteArchivedSession(detail.value.session.id)
    detail.value = null
    await loadPage()
    notice.value = '历史场次已删除'
  } catch (cause) {
    error.value = errorMessage(cause)
  } finally {
    saving.value = false
  }
}

async function exportExcel(): Promise<void> {
  if (!detail.value) return
  saving.value = true
  error.value = ''
  try {
    const path = await window.signIn.exportArchivedSession(detail.value.session.id)
    if (path) notice.value = `已导出：${path}`
  } catch (cause) {
    error.value = errorMessage(cause)
  } finally {
    saving.value = false
  }
}

onMounted(() => void loadPage())
</script>

<template>
  <Dialog
    v-model:open="editingSession"
    title="修改历史场次名称"
    description="修改后会同步更新历史列表。"
  >
    <form class="history-dialog-form" @submit.prevent="renameSession">
      <p v-if="error" class="history-error" role="alert">{{ error }}</p>
      <label>班级名称<input v-model="classNameDraft" maxlength="100" required /></label>
      <div class="history-edit-actions">
        <Button type="button" variant="ghost" @click="editingSession = false">取消</Button
        ><Button type="submit" :disabled="saving">保存修改</Button>
      </div>
    </form>
  </Dialog>
  <Dialog
    :open="!!editingStudentId"
    title="修改学生考勤"
    :description="
      detail?.entries.find((entry) => entry.studentId === editingStudentId)?.studentName
    "
    @update:open="
      (value) => {
        if (!value) editingStudentId = null
      }
    "
  >
    <form class="history-dialog-form" @submit.prevent="saveEntry">
      <p v-if="error" class="history-error" role="alert">{{ error }}</p>
      <label
        >状态<select v-model="statusDraft">
          <option value="signed">已签到</option>
          <option value="late">迟到</option>
          <option value="leave">请假</option>
          <option value="absent">未签到</option>
        </select></label
      >
      <label v-if="statusDraft === 'signed' || statusDraft === 'late'"
        >签到时间<input v-model="signedAtDraft" type="datetime-local" required
      /></label>
      <label v-if="statusDraft === 'signed' || statusDraft === 'late'"
        >电脑名称<input v-model="stationDraft" maxlength="100" required
      /></label>
      <label
        >学生标记<select v-model="markDraft">
          <option value="">无标记</option>
          <option value="leave">请假</option>
          <option value="withdrawn">退学</option>
          <option value="other">其它情况</option>
        </select></label
      >
      <label v-if="markDraft"
        >{{ markDraft === 'other' ? '其它情况' : '备注（可选）'
        }}<input v-model="remarkDraft" maxlength="100" :required="markDraft === 'other'"
      /></label>
      <div class="history-edit-actions">
        <Button type="button" variant="ghost" @click="editingStudentId = null">取消</Button
        ><Button type="submit" :disabled="saving">保存修改</Button>
      </div>
    </form>
  </Dialog>
  <section class="history">
    <header class="history-heading">
      <div>
        <h1>历史签到</h1>
        <p>场次结束后自动保存到本机，可查询、修正并导出 Excel。</p>
      </div>
      <CalendarDays :size="25" aria-hidden="true" />
    </header>

    <form class="history-filters" @submit.prevent="search">
      <label>开始日期<input v-model="from" type="date" :max="to || undefined" /></label>
      <label>结束日期<input v-model="to" type="date" :min="from || undefined" /></label>
      <label class="history-keyword"
        >班级、学生或电脑名称
        <input v-model="keyword" type="search" maxlength="80" placeholder="输入关键词" />
      </label>
      <Button type="submit" :disabled="loading"><Search :size="15" />查询</Button>
    </form>
    <p v-if="error" class="history-error" role="alert">{{ error }}</p>
    <p v-if="notice" class="history-notice" role="status">{{ notice }}</p>

    <div class="history-list">
      <div class="history-list-title">
        <strong>已保存场次</strong>
        <span>{{ list?.total ?? 0 }} 场</span>
      </div>
      <p v-if="loading" class="history-empty">正在加载历史场次…</p>
      <p v-else-if="!list?.items.length" class="history-empty">
        没有符合条件的场次。结束一场签到后，这里会自动出现记录。
      </p>
      <button
        v-for="item in list?.items ?? []"
        :key="item.id"
        type="button"
        class="history-session"
        :class="{ selected: detail?.session.id === item.id }"
        :aria-pressed="detail?.session.id === item.id"
        @click="selectSession(item.id)"
      >
        <span class="history-session-main">
          <strong>{{ item.className }}</strong>
          <small>{{ dateTime(item.startedAt) }} · {{ item.departmentName || '未分学部' }}</small>
        </span>
        <span class="history-session-count">实到 {{ item.signed }} / {{ item.total }}</span>
      </button>
      <div v-if="list && list.total > list.pageSize" class="history-pages">
        <Button
          variant="ghost"
          size="sm"
          :disabled="page <= 1 || loading"
          @click="changePage(page - 1)"
          >上一页</Button
        >
        <span>{{ page }} / {{ totalPages }}</span>
        <Button
          variant="ghost"
          size="sm"
          :disabled="page >= totalPages || loading"
          @click="changePage(page + 1)"
          >下一页</Button
        >
      </div>
    </div>

    <section v-if="detail" class="history-detail">
      <div class="history-detail-head">
        <div>
          <h2>{{ detail.session.className }}</h2>
          <p>{{ dateTime(detail.session.startedAt) }} 至 {{ dateTime(detail.session.endedAt) }}</p>
        </div>
        <div class="history-actions">
          <Button variant="outline" size="sm" :disabled="saving" @click="editSession"
            ><Pencil :size="14" />改名称</Button
          >
          <Button variant="outline" size="sm" :disabled="saving" @click="exportExcel"
            ><Download :size="14" />导出 Excel</Button
          >
          <Button variant="ghost" size="sm" class="danger" :disabled="saving" @click="deleteSession"
            ><Trash2 :size="14" />删除场次</Button
          >
        </div>
      </div>
      <div class="history-stats">
        <span
          >应到 <strong>{{ detail.session.total }}</strong></span
        >
        <span
          >实到 <strong>{{ detail.session.signed }}</strong></span
        >
        <span
          >迟到 <strong>{{ detail.session.late }}</strong></span
        >
        <span
          >请假 <strong>{{ detail.session.leave }}</strong></span
        >
        <span
          >未到 <strong>{{ detail.session.absent }}</strong></span
        >
      </div>
      <p v-if="detail.session.rosterNotice" class="history-roster-note">
        {{ detail.session.rosterNotice }}
      </p>
      <div class="history-detail-filters">
        <input
          v-model="entryKeyword"
          type="search"
          placeholder="筛选姓名、学号或电脑"
          aria-label="筛选学生记录"
        />
        <select v-model="entryStatus" aria-label="筛选考勤状态">
          <option value="all">全部状态</option>
          <option value="signed">已签到</option>
          <option value="late">迟到</option>
          <option value="leave">请假</option>
          <option value="absent">未签到</option>
        </select>
        <span>显示 {{ visibleEntries.length }} 条</span>
      </div>
      <div class="history-table-wrap">
        <table class="history-table">
          <thead>
            <tr>
              <th>序号</th>
              <th>学生</th>
              <th>状态</th>
              <th>签到时间</th>
              <th>电脑名称</th>
              <th>标记</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(entry, index) in visibleEntries" :key="entry.studentId">
              <td>{{ index + 1 }}</td>
              <td>
                <strong>{{ entry.studentName }}</strong
                ><small>{{ entry.studentId }}</small>
              </td>
              <td>
                {{
                  entry.attendance === 'signed'
                    ? '已签到'
                    : entry.attendance === 'late'
                      ? '迟到'
                      : entry.attendance === 'leave'
                        ? '请假'
                        : '未签到'
                }}
              </td>
              <td>{{ dateTime(entry.signedAt) }}</td>
              <td>{{ entry.stationId || '—' }}</td>
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
              <td class="history-row-actions">
                <Button variant="ghost" size="sm" :disabled="saving" @click="editEntry(entry)"
                  >编辑</Button
                >
                <Button
                  variant="ghost"
                  size="sm"
                  class="danger"
                  :disabled="saving"
                  @click="deleteEntry(entry)"
                  >删除</Button
                >
              </td>
            </tr>
          </tbody>
        </table>
        <p v-if="!visibleEntries.length" class="history-empty">没有符合条件的学生记录。</p>
      </div>
    </section>
    <p v-else-if="list?.items.length" class="history-hint">
      选择一场签到，查看学生明细和导出文件。
    </p>
  </section>
</template>

<style scoped>
.history {
  display: grid;
  gap: 18px;
}
.history-heading {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  color: hsl(var(--primary));
}
.history-heading h1 {
  margin: 0;
  color: hsl(var(--foreground));
  font-size: 24px;
  font-weight: 700;
}
.history-heading p {
  margin: 8px 0 0;
  color: hsl(var(--muted-foreground));
  font-size: 13px;
}
.history-filters {
  display: flex;
  flex-wrap: wrap;
  align-items: end;
  gap: 12px;
  padding: 17px;
  border: 1px solid hsl(var(--border));
  border-radius: 13px;
  background: hsl(var(--card));
}
.history-filters label,
.history-edit label {
  display: grid;
  gap: 6px;
  color: hsl(var(--muted-foreground));
  font-size: 12px;
  font-weight: 600;
}
.history-keyword {
  flex: 1 1 190px;
}
input,
select {
  min-height: 36px;
  min-width: 0;
  padding: 0 10px;
  border: 1px solid hsl(var(--border));
  border-radius: 8px;
  outline: none;
  background: hsl(var(--background));
  color: hsl(var(--foreground));
  font: inherit;
}
input:focus,
select:focus {
  border-color: hsl(var(--primary));
  box-shadow: 0 0 0 2px hsl(var(--primary) / 0.15);
}
.history-error,
.history-notice,
.history-roster-note {
  margin: 0;
  padding: 10px 13px;
  border-radius: 8px;
  font-size: 12px;
  overflow-wrap: anywhere;
}
.history-error {
  background: #fff0f0;
  color: #b42f38;
}
.history-notice {
  background: #eaf8ef;
  color: #18794e;
}
.history-roster-note {
  background: #fff6e9;
  color: #8c5a15;
}
.history-list,
.history-detail {
  overflow: hidden;
  border: 1px solid hsl(var(--border));
  border-radius: 13px;
  background: hsl(var(--card));
}
.history-list-title {
  display: flex;
  justify-content: space-between;
  padding: 16px 18px;
  border-bottom: 1px solid hsl(var(--border));
  font-size: 14px;
}
.history-list-title span {
  color: hsl(var(--muted-foreground));
  font-size: 12px;
}
.history-session {
  display: flex;
  width: 100%;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 13px 18px;
  border: 0;
  border-bottom: 1px solid hsl(var(--border));
  background: transparent;
  color: hsl(var(--foreground));
  text-align: left;
  cursor: pointer;
}
.history-session:hover,
.history-session.selected {
  background: hsl(var(--secondary));
}
.history-session-main {
  display: grid;
  min-width: 0;
  gap: 4px;
}
.history-session-main strong {
  overflow: hidden;
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.history-session-main small {
  color: hsl(var(--muted-foreground));
  font-size: 11px;
}
.history-session-count {
  flex: none;
  color: hsl(var(--muted-foreground));
  font-size: 12px;
}
.history-pages {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 9px;
  font-size: 12px;
}
.history-empty,
.history-hint {
  margin: 0;
  padding: 26px 16px;
  color: hsl(var(--muted-foreground));
  font-size: 13px;
  text-align: center;
}
.history-detail {
  padding: 19px;
}
.history-detail-head {
  display: flex;
  flex-wrap: wrap;
  align-items: start;
  justify-content: space-between;
  gap: 12px;
}
.history-detail-head h2 {
  margin: 0;
  font-size: 18px;
}
.history-detail-head p {
  margin: 6px 0 0;
  color: hsl(var(--muted-foreground));
  font-size: 12px;
}
.history-actions,
.history-rename,
.history-edit-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}
.history-actions :deep(button) {
  white-space: nowrap;
}
.danger {
  color: #c14b4f;
}
.history-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  margin: 17px 0;
  padding: 13px 0;
  border-top: 1px solid hsl(var(--border));
  border-bottom: 1px solid hsl(var(--border));
  color: hsl(var(--muted-foreground));
  font-size: 12px;
}
.history-stats strong {
  margin-left: 3px;
  color: hsl(var(--foreground));
  font-size: 16px;
}
.history-detail-filters {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 9px;
  margin: 18px 0 10px;
}
.history-detail-filters input {
  flex: 1 1 190px;
}
.history-detail-filters span {
  color: hsl(var(--muted-foreground));
  font-size: 11px;
}
.history-table-wrap {
  overflow-x: auto;
}
.history-table {
  width: 100%;
  min-width: 620px;
  border-collapse: collapse;
  font-size: 12px;
  text-align: left;
}
.history-table th,
.history-table td {
  padding: 11px 8px;
  border-bottom: 1px solid hsl(var(--border));
}
.history-table th {
  color: hsl(var(--muted-foreground));
  font-weight: 600;
  white-space: nowrap;
}
.history-table td small {
  display: block;
  margin-top: 3px;
  color: hsl(var(--muted-foreground));
}
.history-row-actions {
  white-space: nowrap;
}
.history-edit {
  display: flex;
  flex-wrap: wrap;
  align-items: end;
  gap: 11px;
  margin-top: 18px;
  padding: 15px;
  border: 1px solid hsl(var(--border));
  border-radius: 9px;
  background: hsl(var(--secondary));
}
.history-edit > strong {
  width: 100%;
  font-size: 13px;
}
.history-edit-actions {
  margin-left: auto;
}
.history-dialog-form {
  display: grid;
  gap: 14px;
}
.history-dialog-form label {
  display: grid;
  gap: 6px;
  color: hsl(var(--muted-foreground));
  font-size: 12px;
  font-weight: 600;
}
.history-dialog-form .history-edit-actions {
  justify-content: flex-end;
  margin-top: 6px;
}
@media (max-width: 850px) {
  .history-session-count {
    display: none;
  }
  .history-detail {
    padding: 14px;
  }
}
</style>
