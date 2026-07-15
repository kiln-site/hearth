import { createFileRoute } from "@tanstack/react-router"

import { redirectLegacyPage } from "@/lib/legacy-route-redirect"

export const Route = createFileRoute("/files")({
  beforeLoad: () => redirectLegacyPage("files"),
})
