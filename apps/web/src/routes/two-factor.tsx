import { createFileRoute } from "@tanstack/react-router"

import { TwoFactorPage } from "@/components/two-factor-page"

export const Route = createFileRoute("/two-factor")({
  component: TwoFactorPage,
})
