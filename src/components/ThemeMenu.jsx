import React from "react";
import { Monitor, Moon, Sun, SunMoon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTheme } from "@/lib/useTheme";

const OPTIONS = [
  { value: "system", label: "System", Icon: Monitor },
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
];

// System / Light / Dark. Owns its state (useTheme), so no page has to pass it
// down. The button always shows the same sun-and-moon glyph, which reads as
// "theme" whatever is chosen (a monitor on the button looked like a screen
// setting); the checked item in the menu shows the current choice. Icon-only
// on phones and on narrow desktops (xl to 2xl), where the single-row header
// has no room for the label.
export default function ThemeMenu() {
  const { preference, setPreference } = useTheme();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          aria-label="Theme"
          title="Theme"
          className="gap-1 shrink-0 max-sm:!size-9 max-sm:!p-0 max-sm:!gap-0 xl:max-2xl:!size-9 xl:max-2xl:!p-0 xl:max-2xl:!gap-0"
        >
          <SunMoon className="size-5" />
          <span className="hidden sm:inline xl:max-2xl:hidden">Theme</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup value={preference} onValueChange={setPreference}>
          {OPTIONS.map(({ value, label, Icon: OptionIcon }) => (
            <DropdownMenuRadioItem key={value} value={value} className="cursor-pointer">
              <OptionIcon />
              {label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
