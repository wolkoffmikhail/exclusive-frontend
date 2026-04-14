"use client"

import * as React from "react"
import { GripVerticalIcon } from "lucide-react"
import * as ResizablePrimitive from "react-resizable-panels"
import { cn } from "@/lib/utils"

// Универсальные резолверы (на случай, если в твоей версии другие экспорты/ESM/CJS)
const PanelGroup: any =
  (ResizablePrimitive as any).PanelGroup ??
  (ResizablePrimitive as any).default?.PanelGroup ??
  (ResizablePrimitive as any).default

const Panel: any =
  (ResizablePrimitive as any).Panel ??
  (ResizablePrimitive as any).default?.Panel

const PanelResizeHandle: any =
  (ResizablePrimitive as any).PanelResizeHandle ??
  (ResizablePrimitive as any).default?.PanelResizeHandle

export function ResizablePanelGroup({ className, ...props }: any) {
  return (
    <PanelGroup
      className={cn(
        "flex h-full w-full data-[panel-group-direction=vertical]:flex-col",
        className
      )}
      {...props}
    />
  )
}

export const ResizablePanel: any = Panel

export function ResizableHandle({ withHandle, className, ...props }: any) {
  return (
    <PanelResizeHandle
      className={cn(
        "relative flex w-px items-center justify-center bg-border after:absolute after:inset-y-0 after:left-1/2 after:w-1 after:-translate-x-1/2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 data-[panel-group-direction=vertical]:h-px data-[panel-group-direction=vertical]:w-full data-[panel-group-direction=vertical]:after:left-0 data-[panel-group-direction=vertical]:after:h-1 data-[panel-group-direction=vertical]:after:w-full data-[panel-group-direction=vertical]:after:-translate-y-1/2 data-[panel-group-direction=vertical]:after:translate-x-0 [&[data-panel-group-direction=vertical]>div]:rotate-90",
        className
      )}
      {...props}
    >
      {withHandle && (
        <div className="z-10 flex h-4 w-3 items-center justify-center rounded-sm border bg-border">
          <GripVerticalIcon className="h-2.5 w-2.5" />
        </div>
      )}
    </PanelResizeHandle>
  )
}
