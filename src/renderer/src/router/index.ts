import { createRouter, createWebHashHistory } from 'vue-router'
import { useRuntimeStore } from '../stores/runtime'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/',
      name: 'home',
      component: () => import('../views/StartupErrorView.vue')
    },
    {
      path: '/teacher',
      name: 'teacher',
      component: () => import('../views/TeacherView.vue'),
      meta: { role: 'teacher' }
    },
    {
      path: '/student',
      name: 'student',
      component: () => import('../views/StudentView.vue'),
      meta: { role: 'student' }
    },
    {
      path: '/startup-error',
      name: 'startup-error',
      component: () => import('../views/StartupErrorView.vue')
    },
    { path: '/:pathMatch(.*)*', redirect: '/' }
  ]
})

router.beforeEach(async (to) => {
  if (to.name === 'startup-error') return true
  const runtimeStore = useRuntimeStore()
  await runtimeStore.initialize()
  if (runtimeStore.error || !runtimeStore.runtime) return { name: 'startup-error' }

  const roleRoute = runtimeStore.runtime.role
  if (to.path === '/') return { name: roleRoute }
  if (to.meta.role !== roleRoute) return { name: roleRoute }
  return true
})

export default router
