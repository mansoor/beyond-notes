import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { httpBatchLink } from '@trpc/client'
import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { router } from './router'
import { applyTheme, currentTheme } from './theme'
import { trpc } from './trpc'
import './styles.css'

// apply the saved theme before first paint so the login screen matches too
applyTheme(currentTheme())

function App() {
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: 1 } } }),
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
