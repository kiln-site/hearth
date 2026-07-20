import * as React from "react"

import { SidebarInset, SidebarProvider } from "@workspace/ui/components/sidebar"

import { AppSidebar } from "@/components/app-sidebar"
import { PanelFooter } from "@/components/panel-footer"

interface AppFrameProps {
  children: React.ReactNode
  navigationDismiss: React.ReactNode
  sidebarDefaultOpen: boolean
  sidebarProps: React.ComponentProps<typeof AppSidebar>
}

export const AppFrame = React.memo(function AppFrame({
  children,
  navigationDismiss,
  sidebarDefaultOpen,
  sidebarProps,
}: AppFrameProps) {
  return (
    <SidebarProvider defaultOpen={sidebarDefaultOpen}>
      {navigationDismiss}
      <AppSidebar {...sidebarProps} />
      <SidebarInset className="h-dvh min-w-0 overflow-hidden">
        <div
          data-slot="app-content"
          className="relative flex min-h-0 flex-1 flex-col overflow-hidden"
        >
          {children}
        </div>
        <PanelFooter />
      </SidebarInset>
    </SidebarProvider>
  )
})
