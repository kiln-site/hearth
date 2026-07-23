import { createFileRoute, redirect } from "@tanstack/react-router"

export const Route = createFileRoute("/_app/server/$serverId/")({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/server/$serverId/console",
      replace: true,
      params: { serverId: params.serverId },
    })
  },
})
