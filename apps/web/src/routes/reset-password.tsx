import { createFileRoute } from "@tanstack/react-router"
import { z } from "zod"

import { ResetPasswordPage } from "@/components/reset-password-page"
import { pageTitle } from "@/lib/page-title"

export const Route = createFileRoute("/reset-password")({
  head: () => ({ meta: [{ title: pageTitle("Reset Password") }] }),
  validateSearch: z.object({
    error: z.string().optional(),
    token: z.string().optional(),
  }),
  component: ResetPasswordRoute,
})

function ResetPasswordRoute() {
  const search = Route.useSearch()
  return <ResetPasswordPage token={search.token} tokenError={search.error} />
}
