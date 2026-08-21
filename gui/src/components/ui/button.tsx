import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

import { cn } from "../../lib/utils";

const buttonVariants = cva(
  "relative inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium text-xs outline-none transition-all duration-120 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
  {
    defaultVariants: {
      size: "default",
      variant: "default",
    },
    variants: {
      size: {
        default: "h-8 px-3 text-xs",
        icon: "size-8",
        "icon-lg": "size-9",
        "icon-sm": "size-7",
        "icon-xs": "size-6",
        "icon-xl": "size-10 [&_svg:not([class*='size-'])]:size-4.5",
        lg: "h-9 px-3.5 text-sm gap-2",
        sm: "h-7 px-2.5 text-xs gap-1.5",
        xs: "h-6 px-2 text-[11px] gap-1",
        xl: "h-10 px-4 text-sm gap-2",
      },
      variant: {
        default:
          "bg-primary text-primary-foreground hover:bg-primary/90 shadow-2xs font-semibold active:scale-[0.98]",
        destructive:
          "bg-destructive text-white hover:bg-destructive/90 shadow-2xs font-semibold active:scale-[0.98]",
        "destructive-outline":
          "border border-destructive/30 bg-destructive/10 text-destructive hover:bg-destructive/20 active:scale-[0.98]",
        ghost:
          "border-transparent text-muted-foreground hover:text-foreground hover:bg-accent/80 active:scale-[0.98]",
        link: "border-transparent text-primary underline-offset-4 hover:underline",
        outline:
          "border border-border/80 bg-card text-foreground hover:bg-accent/70 hover:text-foreground shadow-2xs active:scale-[0.98]",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80 shadow-2xs active:scale-[0.98]",
      },
    },
  },
);

interface ButtonProps extends useRender.ComponentProps<"button"> {
  variant?: VariantProps<typeof buttonVariants>["variant"];
  size?: VariantProps<typeof buttonVariants>["size"];
}

function Button({ className, variant, size, render, ...props }: ButtonProps) {
  const typeValue: React.ButtonHTMLAttributes<HTMLButtonElement>["type"] = render
    ? undefined
    : "button";

  const defaultProps = {
    className: cn(buttonVariants({ className, size, variant })),
    "data-slot": "button",
    type: typeValue,
  };

  return useRender({
    defaultTagName: "button",
    props: mergeProps<"button">(defaultProps, props),
    render,
  });
}

export { Button, buttonVariants };
