import { createFileRoute } from "@tanstack/react-router"

import { FilesSettingsPage } from "@/components/files-settings-page"
import { pageTitle } from "@/lib/page-title"

export const Route = createFileRoute("/_app/settings/files")({
  head: () => ({ meta: [{ title: pageTitle("Files Settings") }] }),
  component: FilesSettingsRoute,
})

function FilesSettingsRoute() {
  return <FilesSettingsPage />
}
