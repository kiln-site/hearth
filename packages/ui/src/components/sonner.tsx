import * as React from "react"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"

const Toaster = React.memo(function Toaster({
  className,
  style,
  ...props
}: ToasterProps) {
  return (
    <Sonner
      theme="dark"
      position="top-center"
      offset={{ top: 12 }}
      mobileOffset={{ top: 8, left: 8, right: 8 }}
      gap={8}
      visibleToasts={4}
      closeButton
      className={cn("kiln-toaster", className)}
      style={{ "--width": "30rem", ...style } as React.CSSProperties}
      containerAriaLabel="Notifications"
      icons={{
        success: <CircleCheckIcon className="size-4 text-emerald-400" />,
        info: <InfoIcon className="size-4 text-sky-400" />,
        warning: <TriangleAlertIcon className="size-4 text-amber-300" />,
        error: <OctagonXIcon className="size-4 text-destructive" />,
        loading: <Loader2Icon className="size-4 animate-spin text-primary" />,
        close: <XIcon className="size-4" />,
      }}
      {...props}
    />
  )
})

export { Toaster }
export { toast } from "sonner"
