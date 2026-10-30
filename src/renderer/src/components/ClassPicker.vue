<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Check, ChevronsUpDown, Search } from '@lucide/vue'
import type { SchoolClass } from '../../../shared/contracts'

const props = withDefaults(
  defineProps<{
    modelValue: string
    classes: SchoolClass[]
    loading?: boolean
    disabled?: boolean
    placeholder?: string
    ariaLabel?: string
  }>(),
  {
    loading: false,
    disabled: false,
    placeholder: '搜索班级名称、班主任或编号',
    ariaLabel: '选择班级'
  }
)

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const open = ref(false)
const query = ref('')
const activeIndex = ref(0)
const rootRef = ref<HTMLElement | null>(null)
const inputRef = ref<HTMLInputElement | null>(null)
const listRef = ref<HTMLUListElement | null>(null)

const selected = computed(() => props.classes.find((item) => item.id === props.modelValue) ?? null)

const searchableText = (item: SchoolClass): string =>
  [item.className, item.departmentName, item.advisorName, item.id]
    .filter((value): value is string => Boolean(value))
    .join(' ')
    .toLowerCase()

const filtered = computed(() => {
  const terms = query.value.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (!terms.length) return props.classes
  return props.classes.filter((item) => {
    const text = searchableText(item)
    return terms.every((term) => text.includes(term))
  })
})

const inputValue = computed(() => (open.value ? query.value : (selected.value?.className ?? '')))

const optionId = (index: number): string | undefined => {
  const item = filtered.value[index]
  return item ? `class-option-${item.id}` : undefined
}

function scrollActiveIntoView(): void {
  void nextTick(() => {
    listRef.value
      ?.querySelector<HTMLElement>('[data-active="true"]')
      ?.scrollIntoView({ block: 'nearest' })
  })
}

function openList(): void {
  if (props.disabled || props.loading || open.value) return
  open.value = true
  query.value = ''
  const index = filtered.value.findIndex((item) => item.id === props.modelValue)
  activeIndex.value = index >= 0 ? index : 0
  void nextTick(() => inputRef.value?.focus())
  scrollActiveIntoView()
}

function closeList(): void {
  open.value = false
  query.value = ''
  activeIndex.value = 0
}

function toggleList(): void {
  if (open.value) closeList()
  else openList()
}

function selectClass(item: SchoolClass): void {
  emit('update:modelValue', item.id)
  closeList()
  inputRef.value?.blur()
}

function onInput(event: Event): void {
  query.value = (event.target as HTMLInputElement).value
  open.value = true
  activeIndex.value = 0
  scrollActiveIntoView()
}

function moveActive(step: number): void {
  const count = filtered.value.length
  if (!count) return
  activeIndex.value = (activeIndex.value + step + count) % count
  scrollActiveIntoView()
}

function onKeydown(event: KeyboardEvent): void {
  if (event.isComposing) return
  if (!open.value) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      openList()
    }
    return
  }
  switch (event.key) {
    case 'ArrowDown':
      event.preventDefault()
      moveActive(1)
      break
    case 'ArrowUp':
      event.preventDefault()
      moveActive(-1)
      break
    case 'Enter': {
      // 阻止表单在输入框内回车时直接提交
      event.preventDefault()
      const target = filtered.value[activeIndex.value]
      if (target) selectClass(target)
      break
    }
    case 'Escape':
      event.preventDefault()
      closeList()
      break
    case 'Tab':
      closeList()
      break
  }
}

function onDocumentMouseDown(event: MouseEvent): void {
  if (!open.value) return
  if (!rootRef.value?.contains(event.target as Node)) closeList()
}

watch(
  () => props.classes,
  () => {
    if (!open.value) return
    if (activeIndex.value >= filtered.value.length) {
      activeIndex.value = Math.max(0, filtered.value.length - 1)
    }
  }
)

onMounted(() => document.addEventListener('mousedown', onDocumentMouseDown))
onBeforeUnmount(() => document.removeEventListener('mousedown', onDocumentMouseDown))
</script>

<template>
  <div ref="rootRef" class="class-picker">
    <div class="picker-control" :class="{ 'is-open': open, 'is-disabled': disabled || loading }">
      <Search class="picker-search-icon" :size="16" />
      <input
        ref="inputRef"
        class="picker-input"
        type="text"
        role="combobox"
        autocomplete="off"
        spellcheck="false"
        aria-autocomplete="list"
        aria-controls="class-picker-listbox"
        :aria-label="ariaLabel"
        :aria-expanded="open"
        :aria-activedescendant="open ? optionId(activeIndex) : undefined"
        :value="inputValue"
        :disabled="disabled || loading"
        :placeholder="loading ? '正在加载班级列表…' : placeholder"
        @focus="openList"
        @click="openList"
        @input="onInput"
        @keydown="onKeydown"
      />
      <button
        type="button"
        class="picker-toggle"
        tabindex="-1"
        aria-hidden="true"
        :disabled="disabled || loading"
        @mousedown.prevent
        @click="toggleList"
      >
        <ChevronsUpDown :size="15" />
      </button>
    </div>

    <ul
      v-if="open"
      id="class-picker-listbox"
      ref="listRef"
      class="picker-list"
      role="listbox"
      :aria-label="ariaLabel"
    >
      <li
        v-for="(item, index) in filtered"
        :id="`class-option-${item.id}`"
        :key="item.id"
        class="picker-option"
        :class="{ 'is-active': index === activeIndex, 'is-selected': item.id === modelValue }"
        :data-active="index === activeIndex"
        role="option"
        :aria-selected="item.id === modelValue"
        @mousedown.prevent
        @mouseenter="activeIndex = index"
        @click="selectClass(item)"
      >
        <span class="option-copy">
          <strong>{{ item.className }}</strong>
          <small v-if="item.departmentName">{{ item.departmentName }}</small>
        </span>
        <span class="option-meta">
          <span v-if="item.advisorName">班主任 {{ item.advisorName }}</span>
          <span v-if="item.size != null">{{ item.size }} 人</span>
        </span>
        <Check v-if="item.id === modelValue" class="option-check" :size="15" />
      </li>
      <li v-if="!filtered.length" class="picker-empty">
        {{ classes.length ? '没有匹配的班级' : '暂无可选班级' }}
      </li>
    </ul>
  </div>
</template>

<style scoped>
.class-picker {
  position: relative;
  width: 100%;
}

.picker-control {
  position: relative;
  display: flex;
  align-items: center;
  width: 100%;
  height: 44px;
  border: 1px solid hsl(var(--input));
  border-radius: 10px;
  background: hsl(var(--card));
  transition:
    border-color 0.15s,
    box-shadow 0.15s;
}

.picker-control.is-open,
.picker-control:focus-within {
  border-color: hsl(var(--ring));
  box-shadow: 0 0 0 3px hsl(var(--ring) / 0.22);
}

.picker-control.is-disabled {
  opacity: 0.65;
}

.picker-search-icon {
  position: absolute;
  left: 13px;
  color: hsl(var(--muted-foreground));
  pointer-events: none;
}

.picker-input {
  width: 100%;
  height: 100%;
  border: 0;
  border-radius: 10px;
  background: transparent;
  padding: 0 42px 0 38px;
  color: hsl(var(--foreground));
  font-size: 14px;
  outline: none;
}

.picker-input:focus-visible {
  outline: none;
}

.picker-input::placeholder {
  color: hsl(var(--muted-foreground) / 0.85);
}

.picker-toggle {
  position: absolute;
  right: 8px;
  display: grid;
  width: 28px;
  height: 28px;
  place-items: center;
  border-radius: 7px;
  color: hsl(var(--muted-foreground));
}

.picker-toggle:hover:not(:disabled) {
  background: hsl(var(--accent));
  color: hsl(var(--accent-foreground));
}

.picker-toggle:disabled {
  cursor: default;
  opacity: 0.5;
}

.picker-list {
  position: absolute;
  z-index: 30;
  top: calc(100% + 6px);
  right: 0;
  left: 0;
  max-height: 286px;
  overflow-y: auto;
  margin: 0;
  padding: 6px;
  border: 1px solid hsl(var(--border));
  border-radius: 12px;
  background: hsl(var(--card));
  box-shadow: 0 16px 40px rgba(29, 63, 117, 0.16);
  list-style: none;
}

.picker-option {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 44px;
  padding: 8px 11px;
  border-radius: 8px;
  color: hsl(var(--foreground));
  cursor: pointer;
}

.picker-option.is-active {
  background: hsl(var(--accent));
  color: hsl(var(--accent-foreground));
}

.option-copy {
  display: grid;
  min-width: 0;
  gap: 3px;
}

.option-copy strong {
  overflow: hidden;
  font-size: 13px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.option-copy small {
  overflow: hidden;
  color: hsl(var(--muted-foreground));
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.option-meta {
  display: flex;
  flex: none;
  gap: 8px;
  margin-left: auto;
  color: hsl(var(--muted-foreground));
  font-size: 11px;
  white-space: nowrap;
}

.option-check {
  flex: none;
  color: hsl(var(--primary));
}

.picker-empty {
  padding: 18px 12px;
  color: hsl(var(--muted-foreground));
  font-size: 13px;
  text-align: center;
}
</style>
