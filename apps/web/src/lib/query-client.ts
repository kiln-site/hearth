import { QueryClient } from "@tanstack/react-query"

export interface AppRouterContext {
  queryClient: QueryClient
}

export function createAppQueryClient() {
  return new QueryClient({
    defaultOptions: {
      mutations: {
        retry: false,
      },
      queries: {
        gcTime: 10 * 60_000,
        retry: 1,
        staleTime: 5_000,
      },
    },
  })
}
