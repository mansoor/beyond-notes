import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { httpBatchLink } from '@trpc/client'
import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { router } from './router'
import { currentTheme, previewTheme } from './theme'
import { trpc } from './trpc'
import './styles.css'

// apply the saved theme before first paint so the login screen matches too.
// preview (not apply) so it doesn't *write* localStorage — a device with no
// stored choice stays "unset", the signal Shell uses to adopt the account
// default theme on first login.
previewTheme(currentTheme())

function App() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // A freshly-launched PWA (mobile radio still waking, a proxy/backend
            // briefly cold) can get a network error or a non-JSON body on the
            // very first request — which surfaced as a scary "…is not valid
            // JSON" on the sign-in gate until a manual refresh. Retry transient
            // failures with backoff so the retry does what that refresh did; a
            // real 4xx (auth/forbidden/not-found) is not transient, so skip it.
            retry: (failureCount, error) => {
              const status = (error as { data?: { httpStatus?: number } })?.data?.httpStatus
              if (typeof status === 'number' && status >= 400 && status < 500) return false
              return failureCount < 3
            },
            retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
          },
        },
      }),
  )
  const [trpcClient] = useState(() =>
    // maxURLLength splits large GET batches — enough parallel queries on one
    // screen (trees + rail) can otherwise overflow the server's URL limit (414)
    trpc.createClient({ links: [httpBatchLink({ url: '/api/trpc', maxURLLength: 2000 })] }),
  )
  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </trpc.Provider>
  )
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
