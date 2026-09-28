import { resolve } from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// An add-on edition swaps in its own web module here (see src/edition/types.ts).
// The public build always uses the community module, which adds nothing.
const editionWeb = process.env.BN_EDITION_WEB
  ? resolve(process.env.BN_EDITION_WEB)
  : resolve(__dirname, 'src/edition/community.ts')

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@bn/edition-web': editionWeb },
    // an edition module lives outside this package; make sure it shares the
    // app's single copy of React and react-query rather than bundling its own
    dedupe: ['react', 'react-dom', '@tanstack/react-query'],
  },
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
