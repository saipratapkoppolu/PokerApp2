import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
  build: {
    rollupOptions: {
      output: {
        // Libraries in their own files: they rarely change, so after an update the browser keeps them and only
        // downloads the app's own (much smaller) file again.
        manualChunks: {
          firebase: ['firebase/app', 'firebase/auth', 'firebase/database', 'firebase/messaging'],
          react: ['react', 'react-dom'],
        },
      },
    },
  },
})
