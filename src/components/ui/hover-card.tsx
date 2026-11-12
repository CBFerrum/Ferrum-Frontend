"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { usePortalContainer } from "@/lib/portal"
import { HoverCard as HoverCardPrimitive } from "radix-ui"

function HoverCard({
  ...props
}: React.ComponentProps<typeof HoverCardPrimitive.Root>) {
  return <HoverCardPrimitive.Root data-slot="hover-card" {...props} />
}

function HoverCardTrigger({
  ...props
}: React.ComponentProps<typeof HoverCardPrimitive.Trigger>) {
  return (
    <HoverCardPrimitive.Trigger data-slot="hover-card-trigger" {...props} />
  )
}

function HoverCardContent({
  className,
  align = "center",
  sideOffset = 4,
  container,
  ...props
}: React.ComponentProps<typeof HoverCardPrimitive.Content> & {
  /** Where it is drawn; by default the open dialog around it, else the page's overlay root (lib/portal). */
  container?: HTMLElement | null
}) {
  const around = usePortalContainer()
  return (
    <HoverCardPrimitive.Portal data-slot="hover-card-portal" container={container ?? around}>
      <HoverCardPrimitive.Content
        data-slot="hover-card-content"
        align={align}
        sideOffset={sideOffset}
        className={cn(
          "z-50 duration-(--duration-overlay) w-64 origin-(--radix-hover-card-content-transform-origin) rounded-lg border bg-popover p-4 text-popover-foreground shadow-(--shadow) outline-hidden data-[side=bottom]:slide-in-from-top-1 data-[side=left]:slide-in-from-right-1 data-[side=right]:slide-in-from-left-1 data-[side=top]:slide-in-from-bottom-1 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-97 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-97",
          className
        )}
        {...props}
      />
    </HoverCardPrimitive.Portal>
  )
}

export { HoverCard, HoverCardTrigger, HoverCardContent }
