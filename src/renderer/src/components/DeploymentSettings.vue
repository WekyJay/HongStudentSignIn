<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { Check, FolderOpen, Minus, Radio, RotateCw, School, X } from '@lucide/vue'
import type { AppSettings } from '../../../shared/contracts'
import Button from './ui/button/Button.vue'

const props = defineProps<{
  settings: AppSettings
  logoDataUrl: string | null
  firstRun?: boolean
  standalone?: boolean
  teacherUrl: string
}>()
const emit = defineEmits<{ close: [] }>()

const form = reactive<AppSettings>({ ...props.settings })
const busy = ref(false)
const error = ref('')
const customLogoPreview = ref('')
const saved = ref(false)
const logoPreview = computed(() => customLogoPreview.value || props.logoDataUrl)

function minimizeWindow(): void {
  void window.signIn.minimizeWindow()
}

function closeWindow(): void {
  void window.signIn.closeWindow()
}

function restoreBuiltInLogo(): void {
  form.schoolLogoPath = ''
  customLogoPreview.value = ''
}

watch(
  () => props.settings,
  (settings) => Object.assign(form, settings),
  { deep: true }
)

async function chooseLogo(): Promise<void> {
  error.value = ''
  try {
    const selected = await window.signIn.selectSchoolLogo()
    if (!selected) return
    form.schoolLogoPath = selected.path
    customLogoPreview.value = selected.preview
  } catch (cause) {
    error.value = (cause as Error).message
  }
}

async function save(): Promise<void> {
  error.value = ''
  saved.value = false
  busy.value = true
  try {
    await window.signIn.saveAppSettings({ ...form })
    saved.value = true
  } catch (cause) {
    error.value = (cause as Error).message
    busy.value = false
  }
}
</script>

<template>
  <section class="setup-shell" :class="{ 'is-standalone': standalone }">
    <div v-if="standalone" class="setup-titlebar">
      <div class="setup-titlebar-drag" />
      <Button variant="ghost" size="icon" aria-label="最小化" @click="minimizeWindow">
        <Minus :size="15" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label="关闭"
        @click="firstRun ? closeWindow() : emit('close')"
      >
        <X :size="15" />
      </Button>
    </div>
    <section v-if="firstRun" class="setup-intro">
      <img v-if="logoPreview" class="setup-logo" :src="logoPreview" alt="学校 Logo" />
      <School v-else class="setup-logo-fallback" :size="28" />
      <h1>先完成教师端设置</h1>
      <p>填好学校服务信息后，教师端就能登录；学生端会自动发现这台电脑。</p>
      <div class="setup-network-note">
        <Radio :size="17" />
        <span>学生端安装后自动发现教师机，并记录电脑名称</span>
      </div>
    </section>
    <header v-else class="settings-heading">
      <h2>学校与机房</h2>
      <p>在这里填写学校信息。学生端会自动发现教师机，无需单独配置。</p>
    </header>

    <form class="setup-form" @submit.prevent="save">
      <section class="setup-section">
        <div class="section-title">
          <School :size="17" />
          <div>
            <h3>学校信息</h3>
            <p>用于教师工作台和学生签到页面</p>
          </div>
        </div>
        <label class="setup-field">
          <span>学校名称</span>
          <input
            v-model.trim="form.schoolName"
            autocomplete="organization"
            maxlength="80"
            required
          />
        </label>
        <div class="logo-field">
          <div class="logo-preview-frame">
            <img v-if="logoPreview" :src="logoPreview" alt="当前学校 Logo" />
            <School v-else :size="25" />
          </div>
          <div class="logo-copy">
            <strong>学校 Logo</strong>
            <small>{{ form.schoolLogoPath ? '已选择自定义图片' : '正在使用内置原版 Logo' }}</small>
          </div>
          <Button type="button" variant="outline" size="sm" @click="chooseLogo">
            <FolderOpen :size="15" />选择图片
          </Button>
          <Button
            v-if="form.schoolLogoPath"
            type="button"
            variant="ghost"
            size="sm"
            @click="restoreBuiltInLogo"
            >恢复内置</Button
          >
        </div>
      </section>

      <section class="setup-section">
        <div class="section-title">
          <Radio :size="17" />
          <div>
            <h3>学校服务</h3>
            <p>教师端从学校服务获取班级和学生名单</p>
          </div>
        </div>
        <label class="setup-field">
          <span>服务地址</span>
          <input
            v-model.trim="form.schoolServerUrl"
            type="url"
            placeholder="https://school.example/api"
            autocomplete="url"
            required
          />
        </label>
        <div class="setup-grid">
          <label class="setup-field">
            <span>微信 AppID</span>
            <input v-model.trim="form.wechatAppId" autocomplete="off" required />
          </label>
          <label class="setup-field">
            <span>微信回调地址</span>
            <input
              v-model.trim="form.wechatRedirectUri"
              type="url"
              placeholder="https://school.example/callback"
              autocomplete="url"
              required
            />
          </label>
        </div>
      </section>

      <details class="setup-advanced">
        <summary>高级网络设置</summary>
        <div class="setup-advanced-content">
          <p>学生端会自动发现教师机，通常无需修改。当前访问地址：{{ teacherUrl }}</p>
          <label class="setup-field port-field">
            <span>教师服务端口</span>
            <input v-model.number="form.listenPort" type="number" min="1024" max="65535" required />
          </label>
          <p class="network-hint">教师机防火墙需允许机房网段访问此 TCP 端口及 UDP 41732。</p>
        </div>
      </details>

      <p v-if="error" class="setup-message is-error" role="alert">{{ error }}</p>
      <p v-else-if="saved" class="setup-message" role="status">
        <Check :size="16" />设置已保存，教师端正在重启…
      </p>
      <div class="setup-actions">
        <span v-if="firstRun" class="setup-required">首次运行需要完成设置</span>
        <span v-else class="setup-required">保存后自动重启并应用设置</span>
        <Button type="submit" :disabled="busy">
          <RotateCw v-if="busy" class="spin-icon" :size="16" />
          {{ busy ? '正在保存…' : '保存并重启' }}
        </Button>
      </div>
    </form>
  </section>
</template>

<style scoped>
.setup-shell {
  color: hsl(var(--foreground));
}
.setup-shell.is-standalone {
  position: relative;
  width: min(760px, calc(100vw - 48px));
  max-height: calc(100vh - 32px);
  margin: 16px auto;
  overflow: auto;
  padding: 20px 26px 24px;
}
.setup-titlebar {
  display: flex;
  height: 30px;
  align-items: center;
  justify-content: flex-end;
  margin: -12px -18px 10px;
}
.setup-titlebar-drag {
  height: 100%;
  flex: 1;
  -webkit-app-region: drag;
}
.setup-titlebar button {
  -webkit-app-region: no-drag;
}
.setup-intro {
  display: grid;
  justify-items: center;
  padding: 4px 18px 18px;
  text-align: center;
}
.setup-logo,
.setup-logo-fallback {
  width: 52px;
  height: 52px;
  margin-bottom: 10px;
  object-fit: contain;
}
.setup-intro h1 {
  margin: 0;
  font-size: 25px;
  letter-spacing: -0.025em;
}
.setup-intro > p,
.settings-heading p {
  max-width: 480px;
  margin: 9px 0 0;
  color: hsl(var(--muted-foreground));
  font-size: 14px;
  line-height: 1.7;
}
.setup-network-note {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
  color: hsl(var(--secondary-foreground));
  font-size: 13px;
}
.settings-heading {
  margin-bottom: 20px;
}
.settings-heading h2 {
  margin: 0;
  font-size: 17px;
}
.setup-form {
  display: grid;
  gap: 15px;
}
.setup-section {
  padding: 19px 20px;
  border: 1px solid hsl(var(--border));
  border-radius: 12px;
  background: hsl(var(--background) / 0.55);
}
.section-title {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin-bottom: 17px;
  color: hsl(var(--primary));
}
.section-title > svg {
  margin-top: 2px;
}
.section-title h3 {
  margin: 0;
  color: hsl(var(--foreground));
  font-size: 14px;
  font-weight: 700;
}
.section-title p {
  margin: 4px 0 0;
  color: hsl(var(--muted-foreground));
  font-size: 12px;
}
.setup-field {
  display: grid;
  gap: 7px;
  min-width: 0;
  color: hsl(var(--foreground));
  font-size: 12px;
  font-weight: 600;
}
.setup-field + .setup-field {
  margin-top: 14px;
}
.setup-field input {
  width: 100%;
  height: 39px;
  padding: 0 11px;
  border: 1px solid hsl(var(--input));
  border-radius: 7px;
  background: hsl(var(--card));
  color: hsl(var(--foreground));
  font-size: 13px;
  font-weight: 400;
}
.setup-grid {
  display: grid;
  grid-template-columns: 0.8fr 1.2fr;
  gap: 14px;
  margin-top: 14px;
}
.logo-field {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 16px;
}
.logo-preview-frame {
  display: grid;
  width: 46px;
  height: 46px;
  flex: none;
  place-items: center;
  overflow: hidden;
  border: 1px solid hsl(var(--border));
  border-radius: 9px;
  background: hsl(var(--card));
  color: hsl(var(--muted-foreground));
}
.logo-preview-frame img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.logo-copy {
  display: grid;
  gap: 4px;
  flex: 1;
  min-width: 0;
  font-size: 12px;
}
.logo-copy small {
  overflow: hidden;
  color: hsl(var(--muted-foreground));
  text-overflow: ellipsis;
  white-space: nowrap;
}
.setup-advanced {
  padding: 14px 20px;
  border: 1px solid hsl(var(--border));
  border-radius: 12px;
  background: hsl(var(--card));
  color: hsl(var(--muted-foreground));
  font-size: 13px;
}
.setup-advanced summary {
  cursor: pointer;
  font-weight: 600;
}
.setup-advanced-content {
  display: grid;
  gap: 12px;
  padding-top: 14px;
}
.setup-advanced-content > p {
  margin: 0;
  line-height: 1.6;
}
.port-field {
  max-width: 220px;
}
.network-hint {
  color: hsl(var(--muted-foreground));
  font-size: 12px;
  line-height: 1.6;
}
.setup-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding-top: 2px;
}
.setup-required {
  color: hsl(var(--muted-foreground));
  font-size: 12px;
}
.setup-message {
  display: flex;
  align-items: center;
  gap: 7px;
  margin: 0;
  color: #16804a;
  font-size: 13px;
}
.setup-message.is-error {
  color: hsl(var(--destructive));
}
.spin-icon {
  animation: spin 1s linear infinite;
}
@keyframes spin {
  to { transform: rotate(360deg); }
}
@media (max-width: 640px) {
  .setup-shell.is-standalone {
    width: calc(100vw - 24px);
    max-height: calc(100vh - 24px);
    margin: 12px auto;
    padding: 25px 18px;
  }
  .setup-grid {
    grid-template-columns: 1fr;
  }
  .logo-field {
    flex-wrap: wrap;
  }
}
@media (prefers-reduced-motion: reduce) {
  .spin-icon {
    animation-duration: 3s;
  }
}
</style>
