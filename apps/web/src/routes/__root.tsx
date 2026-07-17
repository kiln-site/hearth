import {
  HeadContent,
  Scripts,
  createRootRouteWithContext,
} from "@tanstack/react-router"
import { TooltipProvider } from "@workspace/ui/components/tooltip"
import { archivoLatin, jetBrainsMonoLatin } from "@workspace/ui/lib/font-assets"

import appCss from "@workspace/ui/globals.css?url"

import { AppErrorPage, AppNotFoundPage } from "@/components/app-error-page"
import type { AppRouterContext } from "@/lib/query-client"

export const Route = createRootRouteWithContext<AppRouterContext>()({
  head: () => ({
    meta: [
      {
        charSet: "utf-8",
      },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1",
      },
      {
        title: "Kiln",
      },
      {
        name: "description",
        content:
          "Deploy and operate reproducible game server instances with Kiln.",
      },
    ],
    links: [
      {
        rel: "preload",
        href: archivoLatin,
        as: "font",
        type: "font/woff2",
        crossOrigin: "anonymous",
      },
      {
        rel: "preload",
        href: jetBrainsMonoLatin,
        as: "font",
        type: "font/woff2",
        crossOrigin: "anonymous",
      },
      {
        rel: "icon",
        href: "/favicon.svg",
        type: "image/svg+xml",
      },
      {
        rel: "manifest",
        href: "/manifest.json",
      },
      {
        rel: "stylesheet",
        href: appCss,
      },
    ],
  }),
  errorComponent: AppErrorPage,
  notFoundComponent: AppNotFoundPage,
  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        <HeadContent />
      </head>
      <body className="overflow-hidden antialiased">
        <TooltipProvider delayDuration={250}>{children}</TooltipProvider>
        <Scripts />
      </body>
    </html>
  )
}
