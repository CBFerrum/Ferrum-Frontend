"use client"

import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { Toggle as TogglePrimitive } from "radix-ui"

const toggleVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-md text-base font-medium whitespace-nowrap transition-[color,box-shadow] duration-(--duration-state) outline-none hover:bg-muted hover:text-muted-foreground focus-visible:border-ring focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:focus-visible:outline-destructive data-[state=on]:bg-primary-soft data-[state=on]:text-primary data-[state=on]:hover:bg-primary-soft data-[state=on]:hover:text-primary [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-transparent",
        outline:
          "border border-border-strong bg-transparent hover:bg-accent hover:text-accent-foreground data-[state=on]:hover:bg-primary-soft data-[state=on]:hover:text-primary",
      },
      size: {
        default: "h-(--control-h) min-w-(--control-h) px-2",
        sm: "h-(--control-h-sm) min-w-(--control-h-sm) px-1.5 text-sm",
        lg: "h-10 min-w-10 px-2.5",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Toggle({
  className,
  variant,
  size,
  ...props
}: React.ComponentProps<typeof TogglePrimitive.Root> &
  VariantProps<typeof toggleVariants>) {
  return (
    <TogglePrimitive.Root
      data-slot="toggle"
      className={cn(toggleVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Toggle, toggleVariants }
