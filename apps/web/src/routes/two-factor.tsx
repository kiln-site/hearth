import { createFileRoute } from "@tanstack/react-router"

import { TwoFactorPage } from "@/components/two-factor-page"
import { pageTitle } from "@/lib/page-title"

export const Route = createFileRoute("/two-factor")({
  head: () => ({
    meta: [{ title: pageTitle("Two-Factor Authentication") }],
  }),
  component: TwoFactorPage,
})
