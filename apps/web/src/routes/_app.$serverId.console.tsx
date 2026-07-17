import { createFileRoute } from "@tanstack/react-router"

import { pageTitle } from "@/lib/page-title"

export const Route = createFileRoute("/_app/$serverId/console")({
  head: () => ({ meta: [{ title: pageTitle("Console") }] }),
})
