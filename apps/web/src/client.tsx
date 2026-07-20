import { scan } from "react-scan"

import "./instrument.client"

import { StrictMode, startTransition } from "react"
import { StartClient } from "@tanstack/react-start/client"
import { hydrateRoot } from "react-dom/client"

if (import.meta.env.DEV) {
  scan({ enabled: true, showToolbar: true })
}

startTransition(() => {
  hydrateRoot(
    document,
    <StrictMode>
      <StartClient />
    </StrictMode>
  )
})
