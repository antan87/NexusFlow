import type * as React from "react";

import { Button } from "./button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./tooltip";

interface IconButtonProps extends Omit<React.ComponentProps<"button">, "children" | "aria-label" | "title"> {
  /** What it does. This is its accessible name and its tooltip, so say the action, not the picture. */
  label: string;
  icon: React.ReactNode;
  /** Shown beside the label in the tooltip, for an action that has a key. */
  shortcut?: string;
  variant?: "ghost" | "outline";
  size?: "xs" | "sm";
}

/**
 * An action that needs no sentence: an icon that stays quiet until it is hovered or
 * focused, with its name in a tooltip. Use it for the small things around the work
 * (dismiss, reopen, copy, add) so the screen is not a row of labelled blocks. A
 * button whose words carry information, such as an answer or a suggestion, keeps its text.
 */
function IconButton({ label, icon, shortcut, variant = "ghost", size = "xs", className, ...props }: IconButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-label={label}
            className={className}
            data-slot="icon-button"
            size={size === "xs" ? "icon-xs" : "icon-sm"}
            variant={variant}
            {...props}
          >
            {icon}
          </Button>
        }
      />
      <TooltipPopup>
        {label}
        {shortcut && <kbd className="ml-1.5 font-mono text-[10px] text-muted-foreground">{shortcut}</kbd>}
      </TooltipPopup>
    </Tooltip>
  );
}

export { IconButton };
export type { IconButtonProps };
