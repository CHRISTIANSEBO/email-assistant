import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/chat':    'http://127.0.0.1:5000',
      '/chats':   'http://127.0.0.1:5000',
      '/confirm': 'http://127.0.0.1:5000',
      '/stream':  'http://127.0.0.1:5000',
    }
  }
})
