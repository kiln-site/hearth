import { createFileRoute } from "@tanstack/react-router"

import { InfraRouteOutlet } from "@/components/infra-layout"

export const Route = createFileRoute("/_app/infra")({
  component: InfraRouteOutlet,
})
