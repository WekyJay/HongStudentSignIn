<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, shallowRef, useTemplateRef, watch } from 'vue'
import { Eye, EyeOff, Keyboard, Delete } from '@lucide/vue'
import { storeToRefs } from 'pinia'
import { useRuntimeStore } from '../stores/runtime'
import { useStudentStore } from '../stores/student'
import Button from '../components/ui/button/Button.vue'

const runtimeStore = useRuntimeStore()
const studentStore = useStudentStore()
const { runtime } = storeToRefs(runtimeStore)
const { session, idCard, result, connectionError, busy, canSubmit } = storeToRefs(studentStore)
const idCardInput = useTemplateRef<HTMLInputElement>('idCardInput')
const showIdCard = shallowRef(false)
const showKeypad = shallowRef(false)
const keypadKeys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '清空', '0', 'X', '退格']

function onIdInput(event: Event): void {
  idCard.value = (event.target as HTMLInputElement).value
    .toUpperCase()
    .replace(/[^0-9X]/g, '')
    .slice(0, 18)
}

function pressKey(key: string): void {
  if (key === '清空') idCard.value = ''
  else if (key === '退格') idCard.value = idCard.value.slice(0, -1)
  else if (idCard.value.length < 18 && (key !== 'X' || idCard.value.length === 17))
    idCard.value += key
}

const isSuccess = computed(() => result.value?.code === 'SUCCESS')
const schoolName = computed(
  () => session.value?.schoolName || runtime.value?.schoolName || '学校名称'
)
const isLeave = computed(() => result.value?.code === 'ON_LEAVE')
const successDepartment = computed(
  () => result.value?.departmentName || session.value?.departmentName || ''
)
const signedAtLabel = computed(() => {
  const value = result.value?.signedAt
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('zh-CN')
})

onMounted(studentStore.startPolling)
onUnmounted(studentStore.stopPolling)
watch(
  () => session.value?.active,
  async (active) => {
    if (active) {
      await nextTick()
      idCardInput.value?.focus()
    }
  },
  { immediate: true }
)
</script>

<template>
  <main class="student-screen min-h-screen">
    <div class="conn-pill" :class="connectionError ? 'is-offline' : 'is-online'">
      <span class="conn-dot"></span>
      {{ connectionError ? '教师机连接中断' : session?.active ? '签到服务已连接' : '等待签到场次' }}
    </div>

    <div class="stage">
      <img
        v-if="runtime?.schoolLogoDataUrl"
        class="brand-logo"
        :src="runtime.schoolLogoDataUrl"
        :alt="schoolName"
        draggable="false"
      />
      <h1 class="brand-title">{{ schoolName }}</h1>
      <p class="brand-subtitle">学生身份核验终端</p>

      <div class="session-banner" :class="{ 'is-active': session?.active }">
        <span class="banner-item">
          <span class="banner-label">签到班级</span>
          <strong>{{ session?.active ? session.className : '尚未开始' }}</strong>
        </span>
        <template v-if="session?.active && session.departmentName">
          <span class="banner-divider"></span>
          <span class="banner-item">
            <span class="banner-label">所属学部</span>
            <strong>{{ session.departmentName }}</strong>
          </span>
        </template>
        <span class="banner-divider"></span>
        <span class="banner-item">
          <span class="banner-label">电脑名称</span>
          <strong class="tabular-nums">{{ runtime?.stationId }}</strong>
        </span>
      </div>

      <section class="entry-card">
        <div v-if="session?.active">
          <form @submit.prevent="studentStore.submit">
            <label for="id-card" class="field-label">居民身份证号码</label>
            <div class="identity-field">
              <input
                id="id-card"
                ref="idCardInput"
                v-model="idCard"
                class="identity-input"
                :type="showIdCard ? 'text' : 'password'"
                inputmode="text"
                maxlength="18"
                autocomplete="off"
                autocapitalize="characters"
                spellcheck="false"
                aria-describedby="id-card-help"
                placeholder="请输入 18 位身份证号码"
                @input="onIdInput"
              /><button
                type="button"
                class="eye-button"
                :aria-label="showIdCard ? '隐藏身份证号码' : '显示身份证号码'"
                :aria-pressed="showIdCard"
                @click="showIdCard = !showIdCard"
              >
                <EyeOff v-if="showIdCard" :size="20" /><Eye v-else :size="20" />
              </button>
            </div>
            <div class="input-tools">
              <p id="id-card-help" class="field-help">末位可输入 X</p>
              <button
                type="button"
                class="keypad-toggle"
                :aria-expanded="showKeypad"
                @click="showKeypad = !showKeypad"
              >
                <Keyboard :size="16" />{{ showKeypad ? '收起小键盘' : '打开身份证小键盘' }}
              </button>
            </div>
            <div v-if="showKeypad" class="id-keypad" aria-label="身份证小键盘">
              <button
                v-for="key in keypadKeys"
                :key="key"
                type="button"
                :class="{ 'keypad-special': key === '清空' || key === '退格' }"
                :aria-label="key === '退格' ? '删除上一位' : key"
                @click="pressKey(key)"
              >
                <Delete v-if="key === '退格'" :size="20" /><template v-else>{{ key }}</template>
              </button>
            </div>
            <Button class="submit-btn" type="submit" :disabled="!canSubmit">
              {{ busy ? '正在核对信息…' : '确认签到' }}
            </Button>
          </form>

          <div
            v-if="result"
            class="result-banner"
            :class="isSuccess ? 'is-success' : isLeave ? 'is-leave' : 'is-fail'"
          >
            <span class="result-icon">{{ isSuccess ? '✓' : isLeave ? '!' : '✕' }}</span>
            <div class="result-copy">
              <p>
                {{ result.message
                }}<span v-if="result.studentName" class="result-name">{{
                  result.studentName
                }}</span>
              </p>
              <dl v-if="isSuccess" class="result-facts">
                <div v-if="result.className || session?.className">
                  <dt>班级</dt>
                  <dd>{{ result.className || session?.className }}</dd>
                </div>
                <div v-if="successDepartment">
                  <dt>学部</dt>
                  <dd>{{ successDepartment }}</dd>
                </div>
                <div v-if="signedAtLabel">
                  <dt>签到时间</dt>
                  <dd>{{ signedAtLabel }}</dd>
                </div>
                <div v-if="result.stationId">
                  <dt>电脑名称</dt>
                  <dd>{{ result.stationId }}</dd>
                </div>
              </dl>
            </div>
          </div>
          <p v-if="connectionError" class="result-banner is-fail">
            <span class="result-icon">!</span>
            {{ connectionError }}
          </p>
        </div>

        <div v-else class="waiting-state">
          <div class="waiting-dots" aria-hidden="true"><span></span><span></span><span></span></div>
          <h3>等待签到场次</h3>
          <p>教师开始签到后，输入框会自动出现，请保持本页面开启。</p>
        </div>
      </section>

      <p class="privacy-note">
        <span class="privacy-mark">✓</span>
        仅核对当前班级信息，输入内容在提交后立即清除
      </p>
    </div>

    <svg class="wave-footer" viewBox="0 0 1440 180" preserveAspectRatio="none" aria-hidden="true">
      <path
        class="wave-back"
        d="M0,96 C240,150 480,40 720,80 C960,120 1200,60 1440,100 L1440,180 L0,180 Z"
      />
      <path
        class="wave-front"
        d="M0,130 C260,170 520,90 780,120 C1040,150 1240,105 1440,135 L1440,180 L0,180 Z"
      />
    </svg>
  </main>
</template>

<style scoped>
.student-screen {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  height: 100vh;
  overflow-x: hidden;
  overflow-y: auto;
  background:
    radial-gradient(58% 44% at 18% 0%, rgba(192, 51, 45, 0.08), transparent 70%),
    radial-gradient(66% 52% at 88% 100%, rgba(27, 92, 157, 0.12), transparent 72%),
    hsl(var(--background));
  color: hsl(var(--foreground));
}

.conn-pill {
  position: absolute;
  top: 20px;
  right: 28px;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 14px;
  border-radius: 999px;
  font-size: 12.5px;
  background: hsl(var(--card));
  border: 1px solid hsl(var(--border));
  color: hsl(var(--muted-foreground));
  box-shadow: 0 2px 10px rgba(23, 52, 94, 0.06);
}

.conn-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.is-online .conn-dot {
  background: #16a879;
  box-shadow: 0 0 0 3px rgba(22, 168, 121, 0.14);
}

.is-offline .conn-dot {
  background: #e14d58;
  box-shadow: 0 0 0 3px rgba(225, 77, 88, 0.14);
}

.is-offline {
  color: #c0332d;
}

.stage {
  position: relative;
  z-index: 1;
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 100%;
  max-width: 640px;
  padding: clamp(16px, 3vh, 40px) 24px clamp(96px, 16vh, 150px);
  text-align: center;
}

.brand-logo {
  width: clamp(72px, 11vh, 104px);
  height: auto;
  filter: drop-shadow(0 10px 22px rgba(192, 51, 45, 0.22));
}

.brand-title {
  margin: 14px 0 0;
  font-size: clamp(26px, 3.4vh, 34px);
  font-weight: 800;
  letter-spacing: 0.14em;
}

.brand-subtitle {
  margin: 6px 0 0;
  font-size: 13px;
  letter-spacing: 0.32em;
  color: hsl(var(--muted-foreground));
}

.session-banner {
  display: flex;
  align-items: center;
  gap: 18px;
  margin-top: clamp(14px, 2.6vh, 26px);
  padding: 10px 22px;
  border-radius: 14px;
  background: hsl(var(--card));
  border: 1px solid hsl(var(--border));
  box-shadow: 0 4px 18px rgba(40, 77, 130, 0.05);
}

.session-banner.is-active {
  border-color: rgba(192, 51, 45, 0.35);
}

.banner-item {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 15px;
}

.banner-label {
  font-size: 12px;
  color: hsl(var(--muted-foreground));
}

.is-active .banner-item strong {
  color: #c0332d;
}

.banner-divider {
  width: 1px;
  height: 18px;
  background: hsl(var(--border));
}

.entry-card {
  width: 100%;
  margin-top: clamp(14px, 2.6vh, 24px);
  padding: clamp(22px, 3.6vh, 36px) clamp(22px, 4vw, 40px);
  border-radius: 22px;
  background: hsl(var(--card));
  border: 1px solid hsl(var(--border));
  box-shadow: 0 14px 46px rgba(29, 63, 117, 0.13);
  text-align: left;
}

.field-label {
  display: block;
  margin-bottom: 10px;
  font-size: 14px;
  font-weight: 700;
}

.identity-input {
  width: 100%;
  height: 68px;
  padding: 0 54px 0 20px;
  border: 1.5px solid #ccd9ec;
  border-radius: 14px;
  outline: none;
  background: #fbfdff;
  color: #17345e;
  font-size: 23px;
  text-align: center;
  letter-spacing: 0.16em;
  transition:
    border-color 150ms ease,
    box-shadow 150ms ease;
}
.identity-field {
  position: relative;
}
.eye-button {
  position: absolute;
  right: 12px;
  top: 50%;
  transform: translateY(-50%);
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: #50648a;
  cursor: pointer;
}
.eye-button:hover,
.keypad-toggle:hover {
  background: #edf4ff;
}
.eye-button:focus-visible,
.keypad-toggle:focus-visible,
.id-keypad button:focus-visible {
  outline: 2px solid #3478f6;
  outline-offset: 2px;
}
.input-tools {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.keypad-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: #3478f6;
  font-size: 13px;
  cursor: pointer;
}
.id-keypad {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  margin: 8px 0 14px;
}
.id-keypad button {
  min-height: 42px;
  border: 1px solid #d8e3f2;
  border-radius: 9px;
  background: #f5f8fd;
  color: #17345e;
  font-size: 18px;
  font-weight: 600;
  cursor: pointer;
}
.id-keypad button:hover {
  background: #eaf2ff;
}
.id-keypad .keypad-special {
  color: #50648a;
  font-size: 14px;
}

.identity-input:focus {
  border-color: #c0332d;
  box-shadow: 0 0 0 4px rgba(192, 51, 45, 0.12);
}

.identity-input::placeholder {
  color: #9aabc2;
  font-size: 16px;
  letter-spacing: 0.04em;
}

.field-help {
  margin: 10px 0 0;
  font-size: 12px;
  color: hsl(var(--muted-foreground));
}

.submit-btn {
  margin-top: 20px;
  height: 60px;
  width: 100%;
  border-radius: 14px;
  font-size: 17px;
  font-weight: 800;
  letter-spacing: 0.12em;
  color: #fff;
  background: linear-gradient(135deg, #d14335, #b02a25);
  box-shadow: 0 8px 20px rgba(192, 51, 45, 0.3);
  transition:
    filter 150ms ease,
    transform 100ms ease,
    box-shadow 150ms ease;
}

.submit-btn:hover:not(:disabled) {
  filter: brightness(1.06);
  box-shadow: 0 10px 24px rgba(192, 51, 45, 0.36);
}

.submit-btn:active:not(:disabled) {
  transform: translateY(1px);
}

.submit-btn:disabled {
  cursor: not-allowed;
  opacity: 0.45;
  box-shadow: none;
}

.result-banner {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-top: 20px;
  padding: 14px 18px;
  border-radius: 14px;
  font-size: 15px;
  font-weight: 600;
  line-height: 1.6;
}

.result-banner p {
  margin: 0;
}

.result-copy {
  min-width: 0;
}

.result-facts {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 24px;
  margin: 12px 0 0;
  padding-top: 12px;
  border-top: 1px solid currentColor;
  border-top-color: rgba(21, 115, 71, 0.18);
}

.result-facts div {
  display: flex;
  align-items: baseline;
  gap: 7px;
}

.result-facts dt {
  font-size: 12.5px;
  font-weight: 600;
  opacity: 0.72;
}

.result-facts dd {
  margin: 0;
  font-size: 14px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}

.result-banner.is-success {
  background: #e9f8f0;
  color: #157347;
}

.result-banner.is-fail {
  background: #fceceb;
  color: #b02a25;
}

.result-banner.is-leave {
  background: #fdf3e3;
  color: #b4741c;
}

.result-icon {
  display: grid;
  flex-shrink: 0;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  font-size: 17px;
  font-weight: 800;
  color: #fff;
}

.is-success .result-icon {
  background: #16a879;
}

.is-fail .result-icon {
  background: #d14335;
}

.is-leave .result-icon {
  background: #d9912b;
}

.result-name {
  margin-left: 6px;
  font-size: 17px;
  font-weight: 800;
}

.waiting-state {
  display: grid;
  place-items: center;
  min-height: 240px;
  padding: 16px 0;
  text-align: center;
}

.waiting-state h3 {
  margin: 18px 0 0;
  font-size: 19px;
  font-weight: 700;
}

.waiting-state p {
  max-width: 320px;
  margin: 10px 0 0;
  font-size: 13.5px;
  line-height: 1.7;
  color: hsl(var(--muted-foreground));
}

.waiting-dots {
  display: flex;
  gap: 10px;
}

.waiting-dots span {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #c0332d;
  opacity: 0.25;
  animation: dot-pulse 1.4s infinite ease-in-out;
}

.waiting-dots span:nth-child(2) {
  animation-delay: 0.2s;
}

.waiting-dots span:nth-child(3) {
  animation-delay: 0.4s;
}

@keyframes dot-pulse {
  0%,
  100% {
    opacity: 0.25;
    transform: scale(1);
  }
  40% {
    opacity: 1;
    transform: scale(1.25);
  }
}

.privacy-note {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: clamp(14px, 2.4vh, 22px) 0 0;
  font-size: 12.5px;
  color: hsl(var(--muted-foreground));
}

.privacy-mark {
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  font-size: 11px;
  font-weight: 800;
  color: #c0332d;
  background: rgba(192, 51, 45, 0.1);
}

.wave-footer {
  position: absolute;
  inset-inline: 0;
  bottom: 0;
  z-index: 0;
  width: 100%;
  height: clamp(90px, 15vh, 150px);
  pointer-events: none;
}

.wave-back {
  fill: #5b9cd0;
  opacity: 0.5;
}

.wave-front {
  fill: #1b5c9d;
  opacity: 0.65;
}

:global(:root[data-theme='dark'] .student-screen) {
  background:
    radial-gradient(58% 44% at 18% 0%, rgba(209, 67, 53, 0.12), transparent 70%),
    radial-gradient(66% 52% at 88% 100%, rgba(91, 156, 208, 0.12), transparent 72%),
    hsl(var(--background));
}

:global(:root[data-theme='dark'] .student-screen .identity-input) {
  border-color: hsl(var(--input));
  background: #202123;
  color: hsl(var(--foreground));
}

:global(:root[data-theme='dark'] .student-screen .field-label) {
  color: #d0dbe9;
}

:global(:root[data-theme='dark'] .student-screen .identity-input::placeholder) {
  color: #8394ac;
}

:global(:root[data-theme='dark'] .student-screen .result-banner.is-success) {
  background: #24382d;
  color: #74d6a0;
}

:global(:root[data-theme='dark'] .student-screen .result-banner.is-fail) {
  background: #3c2b2d;
  color: #ff9b9b;
}

:global(:root[data-theme='dark'] .student-screen .result-banner.is-leave) {
  background: #3d372b;
  color: #f4ce78;
}

:global(:root[data-theme='dark'] .student-screen .wave-back) {
  opacity: 0.28;
}

:global(:root[data-theme='dark'] .student-screen .wave-front) {
  opacity: 0.4;
}
</style>
