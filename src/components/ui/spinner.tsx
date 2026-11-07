import { cn } from "@/lib/utils"
import { Loader2Icon } from "lucide-react"
import { t } from "@ferrum/client";

function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
  return (
    <Loader2Icon
      role="status"
      aria-label={t("Loading")}
      className={cn("size-4 animate-spin", className)}
      {...props}
    />
  )
}

export { Spinner }
