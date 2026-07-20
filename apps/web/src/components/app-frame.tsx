import * as React from "react"

import { SidebarInset, SidebarProvider } from "@workspace/ui/components/sidebar"

import { PanelFooter } from "@/components/panel-footer"

interface AppFrameProps {
  children: React.ReactNode
  navigationDismiss: React.ReactNode
  sidebar: React.ReactNode
  sidebarDefaultOpen: boolean
}

export const AppFrame = React.memo(function AppFrame({
  children,
  navigationDismiss,
  sidebar,
  sidebarDefaultOpen,
}: AppFrameProps) {
  return (
    <SidebarProvider defaultOpen={sidebarDefaultOpen}>
      {navigationDismiss}
      {sidebar}
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
