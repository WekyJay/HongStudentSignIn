<script setup lang="ts">
import { nextTick, useTemplateRef, watch } from 'vue'
import { X } from '@lucide/vue'

const open = defineModel<boolean>('open', { required: true })
defineProps<{ title: string; description?: string; wide?: boolean }>()
const dialog = useTemplateRef<HTMLDialogElement>('dialog')
watch(
  open,
  async (value) => {
    await nextTick()
    if (value && !dialog.value?.open) dialog.value?.showModal()
    if (!value && dialog.value?.open) dialog.value.close()
  },
  { immediate: true }
)
</script>

<template>
  <Teleport to="body">
    <dialog
      ref="dialog"
      class="dialog-panel"
      :class="{ 'dialog-wide': wide }"
      :aria-label="title"
      @cancel.prevent="open = false"
      @close="open = false"
    >
      <header class="dialog-header">
        <div>
          <h2>{{ title }}</h2>
          <p v-if="description">{{ description }}</p>
        </div>
        <button type="button" class="dialog-close" aria-label="关闭弹窗" @click="open = false">
          <X :size="18" />
        </button>
      </header>
      <slot />
    </dialog>
  </Teleport>
</template>

<style scoped>
.dialog-panel {
  width: min(100%, 480px);
  max-height: calc(100vh - 40px);
  overflow: auto;
  padding: 24px;
  border: 1px solid hsl(var(--border));
  border-radius: 14px;
  background: hsl(var(--card));
  color: hsl(var(--foreground));
  box-shadow: 0 20px 60px hsl(217 52% 12% / 0.25);
  outline: none;
}
.dialog-panel::backdrop {
  background: rgb(12 17 24 / 0.68);
  backdrop-filter: blur(9px) saturate(0.75);
}
.dialog-wide {
  width: min(calc(100vw - 48px), 1440px);
  max-height: calc(100vh - 48px);
}
.dialog-header {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 20px;
}
.dialog-header h2 {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
}
.dialog-header p {
  margin: 6px 0 0;
  color: hsl(var(--muted-foreground));
  font-size: 13px;
}
.dialog-close {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: hsl(var(--muted-foreground));
  cursor: pointer;
}
.dialog-close:hover {
  background: hsl(var(--muted));
}
.dialog-close:focus-visible {
  outline: 2px solid hsl(var(--ring));
}
</style>
