import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";

import { cn } from "../../lib/utils";

function Card({ className, render, ...props }: useRender.ComponentProps<"div">) {
  const defaultProps = {
    className: cn(
      "relative flex flex-col rounded-lg border border-border bg-card text-card-foreground shadow-2xs transition-colors",
      className,
    ),
    "data-slot": "card",
  };

  return useRender({
    defaultTagName: "div",
    props: mergeProps<"div">(defaultProps, props),
    render,
  });
}

/**
 * Horizontal Card: the base Card is a column; every "icon beside text" row
 * card should use this instead of re-overriding flex-col at the call site.
 */
function CardRow({ className, ...props }: useRender.ComponentProps<"div">) {
  return <Card className={cn("flex-row items-center", className)} {...props} />;
}

function CardFrame({ className, render, ...props }: useRender.ComponentProps<"div">) {
  const defaultProps = {
    className: cn(
      "flex flex-col relative rounded-lg border border-border bg-card text-card-foreground divide-y divide-border/60 overflow-hidden shadow-2xs",
      className,
    ),
    "data-slot": "card-frame",
  };

  return useRender({
    defaultTagName: "div",
    props: mergeProps<"div">(defaultProps, props),
    render,
  });
}

function CardFrameHeader({ className, render, ...props }: useRender.ComponentProps<"div">) {
  const defaultProps = {
    className: cn("relative flex flex-col px-4 py-3 bg-muted/20", className),
    "data-slot": "card-frame-header",
  };

  return useRender({
    defaultTagName: "div",
    props: mergeProps<"div">(defaultProps, props),
    render,
  });
}

function CardFrameTitle({ className, render, ...props }: useRender.ComponentProps<"div">) {
  const defaultProps = {
    className: cn("font-semibold text-xs text-foreground tracking-tight", className),
    "data-slot": "card-frame-title",
  };

  return useRender({
    defaultTagName: "div",
    props: mergeProps<"div">(defaultProps, props),
    render,
  });
}

function CardFrameDescription({ className, render, ...props }: useRender.ComponentProps<"div">) {
  const defaultProps = {
    className: cn("text-muted-foreground text-xs mt-0.5", className),
    "data-slot": "card-frame-description",
  };

  return useRender({
    defaultTagName: "div",
    props: mergeProps<"div">(defaultProps, props),
    render,
  });
}

function CardFrameFooter({ className, render, ...props }: useRender.ComponentProps<"div">) {
  const defaultProps = {
    className: cn("px-4 py-3 bg-muted/10", className),
    "data-slot": "card-frame-footer",
  };

  return useRender({
    defaultTagName: "div",
    props: mergeProps<"div">(defaultProps, props),
    render,
  });
}

function CardHeader({ className, render, ...props }: useRender.ComponentProps<"div">) {
  const defaultProps = {
    className: cn(
      "flex flex-col gap-1.5 p-4 in-[[data-slot=card]:has(>[data-slot=card-panel])]:pb-3",
      className,
    ),
    "data-slot": "card-header",
  };

  return useRender({
    defaultTagName: "div",
    props: mergeProps<"div">(defaultProps, props),
    render,
  });
}

function CardTitle({ className, render, ...props }: useRender.ComponentProps<"div">) {
  const defaultProps = {
    className: cn("font-semibold text-sm leading-tight text-foreground tracking-tight", className),
    "data-slot": "card-title",
  };

  return useRender({
    defaultTagName: "div",
    props: mergeProps<"div">(defaultProps, props),
    render,
  });
}

function CardDescription({ className, render, ...props }: useRender.ComponentProps<"div">) {
  const defaultProps = {
    className: cn("text-muted-foreground text-xs", className),
    "data-slot": "card-description",
  };

  return useRender({
    defaultTagName: "div",
    props: mergeProps<"div">(defaultProps, props),
    render,
  });
}

function CardAction({ className, render, ...props }: useRender.ComponentProps<"div">) {
  const defaultProps = {
    className: cn(
      "self-start justify-self-end inline-flex shrink-0",
      className,
    ),
    "data-slot": "card-action",
  };

  return useRender({
    defaultTagName: "div",
    props: mergeProps<"div">(defaultProps, props),
    render,
  });
}

function CardPanel({ className, render, ...props }: useRender.ComponentProps<"div">) {
  const defaultProps = {
    className: cn(
      "flex-1 p-4 in-[[data-slot=card]:has(>[data-slot=card-header]:not(.border-b))]:pt-0",
      className,
    ),
    "data-slot": "card-panel",
  };

  return useRender({
    defaultTagName: "div",
    props: mergeProps<"div">(defaultProps, props),
    render,
  });
}

function CardFooter({ className, render, ...props }: useRender.ComponentProps<"div">) {
  const defaultProps = {
    className: cn(
      "flex items-center p-4 in-[[data-slot=card]:has(>[data-slot=card-panel])]:pt-3 border-t border-border/60",
      className,
    ),
    "data-slot": "card-footer",
  };

  return useRender({
    defaultTagName: "div",
    props: mergeProps<"div">(defaultProps, props),
    render,
  });
}

export {
  Card,
  CardRow,
  CardFrame,
  CardFrameHeader,
  CardFrameTitle,
  CardFrameDescription,
  CardFrameFooter,
  CardAction,
  CardDescription,
  CardFooter,
  CardHeader,
  CardPanel,
  CardPanel as CardContent,
  CardTitle,
};
