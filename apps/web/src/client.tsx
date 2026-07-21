import { scan } from "react-scan"

import "./instrument.client"

import { StrictMode, startTransition } from "react"
import { StartClient } from "@tanstack/react-start/client"
import { hydrateRoot } from "react-dom/client"

import { createRenderAudit } from "@/lib/render-audit"

if (import.meta.env.DEV) {
  const { audit, onRender } = createRenderAudit()
  window.__hearthRenderAudit = audit
  scan({
    enabled: true,
    onRender,
    showToolbar: true,
    trackUnnecessaryRenders: true,
  })
}

startTransition(() => {
  hydrateRoot(
    document,
    <StrictMode>
      <StartClient />
    </StrictMode>
  )
})
