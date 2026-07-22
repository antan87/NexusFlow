import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";

import { cn } from "../../lib/utils";

function Tabs({ className, ...props }: TabsPrimitive.Root.Props) {
  return <TabsPrimitive.Root className={cn("flex flex-col gap-4", className)} data-slot="tabs" {...props} />;
}

function TabsList({ className, ...props }: TabsPrimitive.List.Props) {
  return (
    <TabsPrimitive.List
      className={cn(
        "relative z-0 flex w-fit items-center gap-1 rounded-lg bg-muted p-1",
        className,
      )}
      data-slot="tabs-list"
      {...props}
    >
      {props.children}
      <TabsPrimitive.Indicator
        className="absolute top-1/2 left-0 z-[-1] h-[calc(100%-0.5rem)] w-(--active-tab-width) -translate-y-1/2 translate-x-(--active-tab-left) rounded-md bg-background shadow-xs transition-all duration-150"
        data-slot="tabs-indicator"
      />
    </TabsPrimitive.List>
  );
}

function TabsTab({ className, ...props }: TabsPrimitive.Tab.Props) {
  return (
    <TabsPrimitive.Tab
      className={cn(
        "flex h-7 cursor-pointer items-center justify-center whitespace-nowrap rounded-md border border-transparent px-2.5 font-medium text-muted-foreground text-sm outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-selected:text-foreground",
        className,
      )}
      data-slot="tabs-tab"
      {...props}
    />
  );
}

function TabsPanel({ className, ...props }: TabsPrimitive.Panel.Props) {
  return (
    <TabsPrimitive.Panel
      className={cn("flex-1 outline-none", className)}
      data-slot="tabs-panel"
      {...props}
    />
  );
}

export { Tabs, TabsList, TabsTab, TabsPanel };
