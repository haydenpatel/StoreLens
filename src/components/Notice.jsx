import React from "react";
import { AlertCircle, Info, TriangleAlert } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

// One place that says what each kind of message looks like:
//   error   - something failed and nothing (or not enough) loaded
//   warning - something loaded, but is incomplete or partly ignored
//   info    - guidance the user can act on, nothing is wrong
const LEVELS = {
  error: { variant: "destructive", Icon: AlertCircle },
  warning: { variant: "warning", Icon: TriangleAlert },
  info: { variant: "info", Icon: Info },
};

// w-fit so a short message hugs its text instead of leaving empty space
// inside the border.
export default function Notice({ level = "info", className, children }) {
  const { variant, Icon } = LEVELS[level] ?? LEVELS.info;
  return (
    <Alert variant={variant} className={cn("w-fit max-w-2xl mx-auto mb-6", className)}>
      <Icon className="h-4 w-4" />
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  );
}
