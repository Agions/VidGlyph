import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './app.vue'
import './assets/styles/global.scss'
import { migrateLegacyStorageKeys } from '@/utils/legacyStorage'
import { logger } from '@/utils/logger'

// 品牌重命名后的一次性本地数据迁移：旧 key 数据复制到新 key，保证配置/凭据不丢失
const migration = migrateLegacyStorageKeys()
if (migration.migrated.length > 0) {
  logger.info('Bootstrap', `已迁移 ${migration.migrated.length} 项本地配置`)
}

const app = createApp(App)
const pinia = createPinia()

app.use(pinia)
app.mount('#app')

// Register service worker for PWA
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Service worker registration failed, ignore
    })
  })
}
