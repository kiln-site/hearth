import { createFileRoute } from "@tanstack/react-router"

import { pageTitle } from "@/lib/page-title"

export const Route = createFileRoute("/_app/$serverId/files")({
  head: () => ({ meta: [{ title: pageTitle("Files") }] }),
})
