import './assets/main.css'
import 'virtual:uno.css'

import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import { usePreferencesStore } from './stores/preferences'

const pinia = createPinia()
const app = createApp(App)

app.use(pinia)
usePreferencesStore(pinia)
app.use(router).mount('#app')
