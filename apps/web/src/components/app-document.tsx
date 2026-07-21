import { HeadContent, Scripts } from "@tanstack/react-router"

import { Toaster } from "@workspace/ui/components/sonner"
import { TooltipProvider } from "@workspace/ui/components/tooltip"

export function AppDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        <HeadContent />
      </head>
      <body className="overflow-hidden antialiased">
        <Toaster />
        <TooltipProvider delayDuration={250}>{children}</TooltipProvider>
        <Scripts />
      </body>
    </html>
  )
}
