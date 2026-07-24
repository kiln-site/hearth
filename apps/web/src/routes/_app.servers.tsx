import { createFileRoute, redirect } from "@tanstack/react-router"
import { z } from "zod"

export const Route = createFileRoute("/_app/servers")({
  validateSearch: z.object({
    search: z.string().optional(),
  }),
  beforeLoad: ({ search }) => {
    throw redirect({
      to: "/infra/servers",
      search,
      replace: true,
    })
  },
})
