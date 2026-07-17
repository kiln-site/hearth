import { createFileRoute, redirect } from "@tanstack/react-router"

export const Route = createFileRoute("/_app/$serverId/")({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/$serverId/console",
      params: { serverId: params.serverId },
      replace: true,
    })
  },
})
