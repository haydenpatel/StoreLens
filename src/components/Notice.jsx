import React from "react";
import { AlertCircle, Info, TriangleAlert, X } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

// One place that says what each kind of message looks like:
//   error   - something failed and nothing (or not enough) loaded; blocking,
//             so it isn't dismissible
//   warning - something loaded, but is incomplete or partly ignored
//   info    - guidance the user can act on, nothing is wrong
// Pass onDismiss to give a message a close button (warnings and info only).
const LEVELS = {
  error: { variant: "destructive", Icon: AlertCircle },
  warning: { variant: "warning", Icon: TriangleAlert },
  info: { variant: "info", Icon: Info },
};

// w-fit so a short message hugs its text instead of leaving empty space
// inside the border.
export default function Notice({ level = "info", onDismiss, className, children }) {
  const { variant, Icon } = LEVELS[level] ?? LEVELS.info;
  return (
    <Alert variant={variant} className={cn("w-fit max-w-2xl mx-auto mb-6", onDismiss && "pr-10", className)}>
      <Icon className="h-4 w-4" />
      <AlertDescription>{children}</AlertDescription>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="absolute right-2 top-2 rounded p-1 opacity-70 transition-opacity hover:opacity-100 hover:bg-black/5 dark:hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </Alert>
  );
}
