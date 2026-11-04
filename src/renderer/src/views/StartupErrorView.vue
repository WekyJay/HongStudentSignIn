<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useRuntimeStore } from '../stores/runtime'
import Card from '../components/ui/card/Card.vue'

const { error } = storeToRefs(useRuntimeStore())
</script>

<template>
  <main class="min-h-screen grid place-items-center bg-background p-8 text-foreground">
    <Card class="max-w-xl p-8">
      <p class="text-sm font-semibold text-brand-600">机房签到</p>
      <h1 class="mt-3 text-2xl font-bold">应用启动失败</h1>
      <p class="mt-3 leading-7 text-muted-foreground">
        {{ error || '应用设置读取失败，请重启应用或联系管理员。' }}
      </p>
    </Card>
  </main>
</template>
