import { useState } from 'react';
import {
  ChevronDown,
  ExternalLink,
  Sparkles,
  Terminal,
  Copy,
} from 'lucide-react';
import { BsOpenai } from 'react-icons/bs';
import { SiClaude, SiGithubcopilot } from 'react-icons/si';
import { AntigravityIcon } from '../../components/icons/AntigravityIcon.js';

import { Button } from '../../components/ui/button.js';
import {
  Menu,
  MenuPopup,
  MenuItem,
  MenuTrigger,
  MenuSeparator,
  MenuGroupLabel,
  MenuSub,
  MenuSubTrigger,
  MenuSubPopup,
} from '../../components/ui/menu.js';
import { Spinner } from '../../components/ui/spinner.js';
import { useAiDetect, useWorkspaceLaunchTargets } from '../../lib/api/queries.js';
import { cn } from '../../lib/utils.js';

interface AIHarnessLauncherProps {
  workspaceId: string;
  workspacePath: string;
  assistants?: string[];
  onLaunchTerminal: (assistant: string) => void | Promise<void>;
  onOpenAppTarget: (targetId: string) => void | Promise<void>;
  onCopyPrompt?: () => void;
  launchingHarness: string | null;
  className?: string;
}

export function AIHarnessLauncher({
  assistants = ['antigravity'],
  onLaunchTerminal,
  onOpenAppTarget,
  onCopyPrompt,
  launchingHarness,
  className,
}: AIHarnessLauncherProps) {
  const [open, setOpen] = useState(false);
  const aiDetect = useAiDetect();
  const launchTargets = useWorkspaceLaunchTargets();

  const isAgyDetected = aiDetect.data?.find((a) => a.name === 'antigravity')?.detected ?? true;
  const isClaudeDetected = aiDetect.data?.find((a) => a.name === 'claude')?.detected ?? false;
  const isCodexDetected = aiDetect.data?.find((a) => a.name === 'codex')?.detected ?? false;
  const isCopilotDetected = aiDetect.data?.find((a) => a.name === 'copilot')?.detected ?? false;

  const hasAgyIde = Boolean(launchTargets.data?.some((t) => t.id === 'antigravity' && t.available));
  const hasClaudeDesktop = Boolean(launchTargets.data?.some((t) => t.id === 'claude-desktop' && t.available));
  const hasCodexDesktop = Boolean(launchTargets.data?.some((t) => t.id === 'codex-desktop' && t.available));

  // Determine primary installed assistant to showcase
  const primaryAssistant = assistants[0] || 'antigravity';

  const isBusy = Boolean(launchingHarness);

  return (
    <Menu open={open} onOpenChange={setOpen}>
      <MenuTrigger
        render={
          <Button
            size="sm"
            variant="default"
            disabled={isBusy}
            className={cn('gap-1.5 font-semibold shadow-sm cursor-pointer', className)}
          >
            {isBusy ? (
              <Spinner className="size-3.5" />
            ) : primaryAssistant === 'antigravity' ? (
              <AntigravityIcon className="size-3.5" />
            ) : primaryAssistant === 'claude' ? (
              <SiClaude className="size-3.5 text-white" />
            ) : primaryAssistant === 'codex' ? (
              <BsOpenai className="size-3.5 text-white" />
            ) : primaryAssistant === 'copilot' ? (
              <SiGithubcopilot className="size-3.5 text-purple-400" />
            ) : (
              <Sparkles className="size-3.5" />
            )}
            <span>Launch AI</span>
            <ChevronDown size={13} className="opacity-70" />
          </Button>
        }
      />
      <MenuPopup align="end" className="w-56">
        <MenuGroupLabel>Detected AI Harnesses</MenuGroupLabel>

        {/* 1. Google Antigravity */}
        {isAgyDetected && (
          hasAgyIde ? (
            <MenuSub>
              <MenuSubTrigger className="cursor-pointer">
                <AntigravityIcon className="size-4" />
                <span>Antigravity</span>
              </MenuSubTrigger>
              <MenuSubPopup>
                <MenuItem
                  onClick={() => {
                    setOpen(false);
                    void onLaunchTerminal('antigravity');
                  }}
                  className="cursor-pointer"
                >
                  <Terminal size={14} />
                  <span>Terminal CLI (agy)</span>
                </MenuItem>
                <MenuItem
                  onClick={() => {
                    setOpen(false);
                    void onOpenAppTarget('antigravity');
                  }}
                  className="cursor-pointer"
                >
                  <AntigravityIcon className="size-3.5" />
                  <span>Antigravity IDE</span>
                </MenuItem>
              </MenuSubPopup>
            </MenuSub>
          ) : (
            <MenuItem
              onClick={() => {
                setOpen(false);
                void onLaunchTerminal('antigravity');
              }}
              className="cursor-pointer"
            >
              <AntigravityIcon className="size-4" />
              <span>Antigravity (agy)</span>
            </MenuItem>
          )
        )}

        {/* 2. Claude Code */}
        {(isClaudeDetected || hasClaudeDesktop) && (
          hasClaudeDesktop ? (
            <MenuSub>
              <MenuSubTrigger className="cursor-pointer">
                <span className="grid size-4 place-items-center rounded bg-[#D97757] text-white text-[9px]">
                  <SiClaude className="size-2.5" />
                </span>
                <span>Claude Code</span>
              </MenuSubTrigger>
              <MenuSubPopup>
                {isClaudeDetected && (
                  <MenuItem
                    onClick={() => {
                      setOpen(false);
                      void onLaunchTerminal('claude');
                    }}
                    className="cursor-pointer"
                  >
                    <Terminal size={14} />
                    <span>Terminal CLI (claude)</span>
                  </MenuItem>
                )}
                <MenuItem
                  onClick={() => {
                    setOpen(false);
                    void onOpenAppTarget('claude-desktop');
                  }}
                  className="cursor-pointer"
                >
                  <ExternalLink size={14} />
                  <span>Claude Desktop</span>
                </MenuItem>
              </MenuSubPopup>
            </MenuSub>
          ) : (
            <MenuItem
              onClick={() => {
                setOpen(false);
                void onLaunchTerminal('claude');
              }}
              className="cursor-pointer"
            >
              <span className="grid size-4 place-items-center rounded bg-[#D97757] text-white text-[9px]">
                <SiClaude className="size-2.5" />
              </span>
              <span>Claude Code (claude)</span>
            </MenuItem>
          )
        )}

        {/* 3. OpenAI Codex (Only if detected) */}
        {(isCodexDetected || hasCodexDesktop) && (
          hasCodexDesktop ? (
            <MenuSub>
              <MenuSubTrigger className="cursor-pointer">
                <BsOpenai className="size-4 text-foreground" />
                <span>OpenAI Codex</span>
              </MenuSubTrigger>
              <MenuSubPopup>
                {isCodexDetected && (
                  <MenuItem
                    onClick={() => {
                      setOpen(false);
                      void onLaunchTerminal('codex');
                    }}
                    className="cursor-pointer"
                  >
                    <Terminal size={14} />
                    <span>Terminal CLI (codex)</span>
                  </MenuItem>
                )}
                <MenuItem
                  onClick={() => {
                    setOpen(false);
                    void onOpenAppTarget('codex-desktop');
                  }}
                  className="cursor-pointer"
                >
                  <ExternalLink size={14} />
                  <span>Codex Desktop</span>
                </MenuItem>
              </MenuSubPopup>
            </MenuSub>
          ) : (
            <MenuItem
              onClick={() => {
                setOpen(false);
                void onLaunchTerminal('codex');
              }}
              className="cursor-pointer"
            >
              <BsOpenai className="size-4 text-foreground" />
              <span>OpenAI Codex (codex)</span>
            </MenuItem>
          )
        )}

        {/* 4. GitHub Copilot (Only if detected) */}
        {isCopilotDetected && (
          <MenuItem
            onClick={() => {
              setOpen(false);
              void onLaunchTerminal('copilot');
            }}
            className="cursor-pointer"
          >
            <SiGithubcopilot className="size-4 text-purple-400" />
            <span>GitHub Copilot (copilot)</span>
          </MenuItem>
        )}

        <MenuSeparator />

        {/* Quick Context & Copy options */}
        {onCopyPrompt && (
          <MenuItem
            onClick={() => {
              setOpen(false);
              onCopyPrompt();
            }}
            className="cursor-pointer"
          >
            <Copy size={14} />
            <span>Copy AI Context</span>
          </MenuItem>
        )}
      </MenuPopup>
    </Menu>
  );
}
