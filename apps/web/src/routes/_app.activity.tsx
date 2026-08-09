import { createFileRoute } from "@tanstack/react-router"
import { z } from "zod"

import { ActivityPage } from "@/components/activity-page"
import type { ActivityFilters } from "@/components/activity-page"
import {
  activityInstantSchema,
  activitySources,
  activityTypes,
} from "@/lib/activity"
import { activityQueryOptions } from "@/lib/query-options"
import { pageTitle } from "@/lib/page-title"

const activitySearchSchema = z
  .object({
    from: activityInstantSchema.optional(),
    q: z.string().max(160).optional(),
    relay: z.string().max(64).optional(),
    server: z.string().max(64).optional(),
    source: z.enum(activitySources).optional(),
    to: activityInstantSchema.optional(),
    type: z.enum(activityTypes).optional(),
    user: z.string().max(64).optional(),
  })
  .refine(
    ({ from, to }) =>
      from === undefined ||
      to === undefined ||
      Date.parse(from) <= Date.parse(to),
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
