import { createFileRoute } from "@tanstack/react-router"
import { z } from "zod"

import { ActivityPage } from "@/components/activity-page"
import type { ActivityFilters } from "@/components/activity-page"
import { activityDateSchema, activityTypes } from "@/lib/activity"
import { activityQueryOptions } from "@/lib/query-options"
import { pageTitle } from "@/lib/page-title"

const activitySearchSchema = z
  .object({
    from: activityDateSchema.optional(),
    q: z.string().max(160).optional(),
    relay: z.string().max(64).optional(),
    server: z.string().max(64).optional(),
    to: activityDateSchema.optional(),
    type: z.enum(activityTypes).optional(),
    user: z.string().max(64).optional(),
  })
  .refine(
    ({ from, to }) => from === undefined || to === undefined || from <= to,
    "Activity start must be before its end"
  )

export const Route = createFileRoute("/_app/activity")({
  validateSearch: activitySearchSchema,
  loaderDeps: ({ search }) => ({ from: search.from, to: search.to }),
  loader: ({ context, deps }) =>
    context.queryClient.ensureQueryData(
      activityQueryOptions(deps.from, deps.to)
    ),
  head: () => ({ meta: [{ title: pageTitle("Activity") }] }),
  component: ActivityRoute,
})

function ActivityRoute() {
  const filters = Route.useSearch()
  const navigate = Route.useNavigate()
  const updateFilters = (change: Partial<ActivityFilters>) => {
    void navigate({
      replace: true,
      search: (previous) => ({ ...previous, ...change }),
    })
  }
  return <ActivityPage filters={filters} onFiltersChange={updateFilters} />
}
