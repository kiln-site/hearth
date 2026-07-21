import * as React from "react"
import { useSuspenseQuery } from "@tanstack/react-query"
import { useRouter } from "@tanstack/react-router"

import {
  SidebarInset,
  SidebarProvider,
  useSidebar,
} from "@workspace/ui/components/sidebar"

import { AppRouteContent } from "@/components/app-route-content"
import { AppSidebar } from "@/components/app-sidebar"
import { PanelFooter } from "@/components/panel-footer"
import { uiPreferencesQueryOptions } from "@/lib/query-options"

export const AppFrame = React.memo(function AppFrame({
  children,
}: {
  children: React.ReactNode
}) {
  const { data: uiPreferences } = useSuspenseQuery(uiPreferencesQueryOptions())

  return (
    <SidebarProvider defaultOpen={uiPreferences.sidebarOpen}>
      <MobileSidebarNavigationDismiss />
      <AppSidebar />
      <SidebarInset className="h-dvh min-w-0 overflow-hidden">
        <div
          data-slot="app-content"
          className="relative flex min-h-0 flex-1 flex-col overflow-hidden"
        >
          <AppRouteContent>{children}</AppRouteContent>
        </div>
        <PanelFooter />
      </SidebarInset>
    </SidebarProvider>
  )
})

function MobileSidebarNavigationDismiss() {
  const { isMobile, setOpenMobile } = useSidebar()
  const router = useRouter()

  React.useEffect(() => {
    return router.subscribe("onBeforeNavigate", () => {
      if (isMobile) setOpenMobile(false)
    })
  }, [isMobile, router, setOpenMobile])

  return null
}
