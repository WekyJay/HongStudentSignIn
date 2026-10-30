<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { Minus, X } from '@lucide/vue'
import Button from './ui/button/Button.vue'
import { useRuntimeStore } from '../stores/runtime'
import { useSchoolStore } from '../stores/school'

const runtimeStore = useRuntimeStore()
const schoolStore = useSchoolStore()
const { runtime } = storeToRefs(runtimeStore)
const wechatError = ref('')
let removeWechatListener: (() => void) | undefined

const qrUrl = computed(() => {
  const info = runtime.value
  if (!info?.wechatAppId || !info.wechatRedirectUri) return ''
  const params = new URLSearchParams({
    appid: info.wechatAppId,
    redirect_uri: info.wechatRedirectUri,
    response_type: 'code',
    scope: 'snsapi_login',
    state: 'pc',
    // 必须让二维码页在 iframe 内部完成跳转：默认行为是 window.top.location = 回调地址，
    // 而 Chromium 会拦截跨域 iframe 在无用户手势时导航顶层窗口，导致扫码后回调永远不触发。
    self_redirect: 'true'
  })
  return `https://open.weixin.qq.com/connect/qrconnect?${params.toString()}#wechat_redirect`
})

function minimizeWindow(): void {
  void window.signIn.minimizeWindow()
}
function closeWindow(): void {
  void window.signIn.closeWindow()
}

onMounted(() => {
  void runtimeStore.initialize()
  removeWechatListener = window.signIn.onWechatLoginResult((result) => {
    if (result.ok && result.auth) {
      schoolStore.applyAuth(result.auth)
      void schoolStore.loadClasses()
    } else {
      wechatError.value = result.error || '微信扫码登录失败，请重试'
    }
  })
})
onUnmounted(() => removeWechatListener?.())
</script>

<template>
  <main class="login-screen grid min-h-screen place-items-center bg-background px-6">
    <div class="login-titlebar">
      <div class="login-titlebar-drag"></div>
      <div class="login-window-controls" aria-label="窗口控制">
        <Button
          variant="ghost"
          size="icon"
          class="login-window-control"
          aria-label="最小化窗口"
          title="最小化"
          @click="minimizeWindow"
        >
          <Minus :size="15" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          class="login-window-control is-close"
          aria-label="关闭窗口"
          title="关闭"
          @click="closeWindow"
        >
          <X :size="15" />
        </Button>
      </div>
    </div>
    <div class="login-panel">
      <img v-if="runtime?.schoolLogoDataUrl" class="login-logo" :src="runtime.schoolLogoDataUrl" :alt="runtime.schoolName" draggable="false" />
      <h1 class="login-title">{{ runtime?.schoolName || '学校名称' }} · 教师工作台</h1>

      <div class="qr-card">
        <iframe v-if="qrUrl" :src="qrUrl" class="qr-frame" title="微信扫码登录"></iframe>
        <p v-else class="qr-loading">{{ runtime ? '请在本机配置学校微信登录参数' : '正在加载配置…' }}</p>
      </div>

      <p class="login-tip">打开微信扫一扫，扫码确认后即可登录</p>
      <p v-if="wechatError" class="login-error">{{ wechatError }}</p>
    </div>
  </main>
</template>

<style scoped>
.login-screen {
  background-image:
    radial-gradient(52% 40% at 15% 0%, rgba(192, 51, 45, 0.07), transparent 70%),
    radial-gradient(60% 48% at 90% 100%, rgba(27, 92, 157, 0.1), transparent 72%);
}

.login-panel {
  display: flex;
  width: 320px;
  max-width: 100%;
  flex-direction: column;
  align-items: center;
  text-align: center;
}

.login-logo {
  width: 56px;
  height: 56px;
  margin-bottom: 14px;
}

.login-title {
  margin: 0;
  font-size: 19px;
  font-weight: 700;
  letter-spacing: 0.02em;
}

.qr-card {
  width: 100%;
  margin-top: 22px;
  padding: 10px;
  border-radius: 14px;
  background: #fff;
  box-shadow:
    0 12px 34px rgba(29, 63, 117, 0.16),
    0 1px 2px rgba(29, 63, 117, 0.12);
}

.qr-frame,
.qr-loading {
  display: block;
  width: 100%;
  height: 400px;
  margin: 0;
  border: 0;
  border-radius: 8px;
}

.qr-loading {
  display: grid;
  place-items: center;
  color: #8b9ab0;
  font-size: 13px;
}

.login-tip {
  margin: 14px 0 0;
  color: hsl(var(--muted-foreground));
  font-size: 12px;
  line-height: 1.6;
}

.login-error {
  width: 100%;
  margin: 12px 0 0;
  border-radius: 10px;
  background: rgba(214, 71, 71, 0.09);
  padding: 10px 12px;
  color: #c33a3a;
  font-size: 12px;
  line-height: 1.7;
  text-align: left;
}

:global(:root[data-theme='dark']) .login-error {
  background: rgba(214, 71, 71, 0.16);
  color: #ff9b9b;
}

.login-titlebar {
  position: fixed;
  inset-inline: 0;
  top: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  height: 40px;
}

.login-titlebar-drag {
  flex: 1;
  height: 100%;
  -webkit-app-region: drag;
}

.login-window-controls {
  display: flex;
  align-items: center;
  gap: 2px;
  padding-right: 8px;
  -webkit-app-region: no-drag;
}

.login-window-control {
  width: 38px;
  height: 30px;
  padding: 0;
  color: hsl(var(--muted-foreground));
}

.login-window-control:hover {
  background: hsl(var(--accent));
  color: hsl(var(--foreground));
}

.login-window-control.is-close:hover {
  background: #e14d58;
  color: #fff;
}
</style>
