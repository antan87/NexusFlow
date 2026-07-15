import { PlusCircle, Settings as SettingsIcon } from 'lucide-react';
import { Button } from '../../components/ui/button.js';
import type { NexusFlowConfig } from '../../types.js';

interface GettingStartedPageProps {
  config: NexusFlowConfig;
  onCreateWorkspace: () => void;
  onModifySettings: () => void;
}

export function GettingStartedPage({
  config,
  onCreateWorkspace,
  onModifySettings,
}: GettingStartedPageProps) {
  return (
    <div className="max-w-4xl mx-auto animate-fade-in">
      <header className="mb-10">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary/10 text-primary border border-primary/20 text-xs font-semibold uppercase tracking-wider mb-4">
          Getting Started Guide
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground mb-2">
          Welcome to NexusFlow
        </h1>
        <p className="text-sm text-muted-foreground">
          NexusFlow orchestrates multi-repository developer environments. It combines isolated Git worktrees, automatic code analyzer sweeps, and background process running into a single dashboard.
        </p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-10">
        {/* Left: Interactive Stepper */}
        <div className="bg-card border border-border rounded-xl p-6 shadow-sm space-y-6">
          <h2 className="text-lg font-semibold text-foreground mb-4">NexusFlow Workflows</h2>
          
          <div className="flex gap-4">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 border border-primary/20 text-primary font-bold text-sm">
              1
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground">Configure Folders</h3>
              <p className="text-xs text-muted-foreground mt-1">
                Specify your Development folder (where repositories live) and Workspaces folder. These are currently set to:
                <code className="block mt-1 text-[10px] text-primary break-all">{config.devDir || 'Not Configured'}</code>
              </p>
            </div>
          </div>

          <div className="flex gap-4">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 border border-primary/20 text-primary font-bold text-sm">
              2
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground">Build Workspaces</h3>
              <p className="text-xs text-muted-foreground mt-1">
                Choose repositories and feature branch. NexusFlow checks out dependencies under a unified workspace directory using Git Worktrees, keeping original projects clean.
              </p>
            </div>
          </div>

          <div className="flex gap-4">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 border border-primary/20 text-primary font-bold text-sm">
              3
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground">Align AI Context</h3>
              <p className="text-xs text-muted-foreground mt-1">
                NexusFlow writes files like <code>CLAUDE.md</code>, <code>.cursorrules</code>, <code>AGENTS.md</code> prompting the LLM to inspect project relations and list key assumptions and questions before coding.
              </p>
            </div>
          </div>
        </div>

        {/* Right: Quick actions and Telemetry info */}
        <div className="bg-card border border-border rounded-xl p-6 shadow-sm flex flex-col justify-between">
          <div>
            <h2 className="text-lg font-semibold text-foreground mb-4">Current Configuration</h2>
            <div className="space-y-3 text-xs">
              <div className="flex justify-between py-1.5 border-b border-border">
                <span className="text-muted-foreground">Dev Folder:</span>
                <span className="text-foreground font-mono text-[10px] truncate max-w-[200px]">{config.devDir}</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-border">
                <span className="text-muted-foreground">Workspaces Folder:</span>
                <span className="text-foreground font-mono text-[10px] truncate max-w-[200px]">{config.workspacesDir}</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-border">
                <span className="text-muted-foreground">Preferred AI:</span>
                <span className="text-primary font-semibold uppercase">{config.defaultAssistant || 'None'}</span>
              </div>
              <div className="flex justify-between py-1.5">
                <span className="text-muted-foreground">Scan Depth:</span>
                <span className="text-foreground font-semibold">{config.scanDepth} levels</span>
              </div>
            </div>
          </div>

          <div className="pt-6 border-t border-border flex flex-col gap-2">
            <Button
              className="w-full gap-2"
              onClick={onCreateWorkspace}
            >
              <PlusCircle size={14} /> Create a Workspace
            </Button>
            <Button
              variant="outline"
              className="w-full gap-2"
              onClick={onModifySettings}
            >
              <SettingsIcon size={14} className="text-muted-foreground" /> Modify Settings
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
