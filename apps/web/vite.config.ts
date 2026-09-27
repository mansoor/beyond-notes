import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:3800',
      // single sign-on redirects (/auth/oidc/login, /auth/oidc/callback)
      '/auth': 'http://127.0.0.1:3800',
      // published-site dev escape (/s/<host>/...). Regex-anchored: a bare '/s'
      // prefix would also swallow /src/*, which is how Vite serves the app.
      '^/s/.*': 'http://127.0.0.1:3800',
    },
  },
})
