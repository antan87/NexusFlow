import React, { useEffect, useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  Boxes,
  Check,
  CheckSquare,
  Square,
  Search,
  Sparkles,
  ExternalLink,
  GitPullRequest,
  FlaskConical,
  Package,
  Database,
  ShieldCheck,
  Terminal,
  Zap,
  Cpu,
  Layers,
  Bot,
  X,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';

import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Card } from '../../components/ui/card.js';
import { Input } from '../../components/ui/input.js';
import { Spinner } from '../../components/ui/spinner.js';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '../../components/ui/empty.js';
import { cn } from '../../lib/utils.js';
import {
  useSkillCategories,
  useSkills,
  useAgents,
  useWorkspaceSkills,
  useAssignWorkspaceSkills,
  useRefreshWorkspace,
} from '../../lib/api/queries.js';
import type { Feature, SkillItem } from '../../types.js';

const ICON_MAP: Record<string, React.ElementType> = {
  'git-pull-request': GitPullRequest,
  'flask-conical': FlaskConical,
  package: Package,
  database: Database,
  'shield-check': ShieldCheck,
  terminal: Terminal,
  zap: Zap,
  cpu: Cpu,
  layers: Layers,
  boxes: Boxes,
};

export interface WorkspaceSkillsTabProps {
  ws: Feature;
  showToast?: (message: string, type?: 'success' | 'error' | 'info', duration?: number) => void;
}

export function WorkspaceSkillsTab({ ws, showToast }: WorkspaceSkillsTabProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [collapsedCategories, setCollapsedCategories] = useState<Record<string, boolean>>({});
  const [draftSkills, setDraftSkills] = useState<string[] | null>(null);
  const [draftAgents, setDraftAgents] = useState<string[] | null>(null);
  const [isDeploying, setIsDeploying] = useState(false);

  const { data: categories = [], isLoading: loadingCategories } = useSkillCategories();
  const { data: skills = [], isLoading: loadingSkills } = useSkills(ws.branchName);
  const { data: agents = [], isLoading: loadingAgents } = useAgents();
  const {
    data: workspaceSkillsConfig,
    isLoading: loadingWorkspaceConfig,
    isError: workspaceConfigError,
  } = useWorkspaceSkills(ws.branchName);

  const assignSkillsMutation = useAssignWorkspaceSkills();
  const refreshWorkspaceMutation = useRefreshWorkspace();

  const enabledSkillSet = useMemo(
    () => new Set(draftSkills ?? workspaceSkillsConfig?.enabledSkills ?? []),
    [draftSkills, workspaceSkillsConfig?.enabledSkills],
  );

  const enabledAgentSet = useMemo(
    () => new Set(draftAgents ?? workspaceSkillsConfig?.enabledAgents ?? []),
    [draftAgents, workspaceSkillsConfig?.enabledAgents],
  );

  // Sync draft state when workspace config loads/changes
  useEffect(() => {
    if (workspaceSkillsConfig) {
      setDraftSkills([...(workspaceSkillsConfig.enabledSkills ?? [])]);
      setDraftAgents([...(workspaceSkillsConfig.enabledAgents ?? [])]);
    }
  }, [workspaceSkillsConfig]);

  const hasUnsavedChanges = useMemo(() => {
    if (!workspaceSkillsConfig || draftSkills === null || draftAgents === null) return false;
    const currentSkills = new Set(workspaceSkillsConfig.enabledSkills ?? []);
    const currentAgents = new Set(workspaceSkillsConfig.enabledAgents ?? []);

    if (draftSkills.length !== currentSkills.size || draftSkills.some((s) => !currentSkills.has(s))) {
      return true;
    }
    if (draftAgents.length !== currentAgents.size || draftAgents.some((a) => !currentAgents.has(a))) {
      return true;
    }
    return false;
  }, [workspaceSkillsConfig, draftSkills, draftAgents]);

  const toggleCategoryCollapse = (catId: string) => {
    setCollapsedCategories((prev) => ({ ...prev, [catId]: !prev[catId] }));
  };

  const handleToggleSkill = (skillId: string) => {
    if (draftSkills === null) return;
    const next = new Set(draftSkills);
    if (next.has(skillId)) {
      next.delete(skillId);
    } else {
      next.add(skillId);
    }
    setDraftSkills(Array.from(next));
  };

  const handleToggleAgent = (agentId: string) => {
    if (draftAgents === null) return;
    const next = new Set(draftAgents);
    if (next.has(agentId)) {
      next.delete(agentId);
    } else {
      next.add(agentId);
    }
    setDraftAgents(Array.from(next));
  };

  const handleToggleCategory = (_catId: string, enable: boolean, categorySkills: SkillItem[]) => {
    if (draftSkills === null) return;
    const next = new Set(draftSkills);
    for (const skill of categorySkills) {
      if (enable) {
        next.add(skill.id);
      } else {
        next.delete(skill.id);
      }
    }
    setDraftSkills(Array.from(next));
  };

  const handleSaveAndDeploy = async () => {
    if (!workspaceSkillsConfig || draftSkills === null || draftAgents === null) return;
    setIsDeploying(true);
    try {
      await assignSkillsMutation.mutateAsync({
        workspaceId: ws.branchName,
        expectedRevision: workspaceSkillsConfig.revision ?? 0,
        enabledSkills: draftSkills,
        enabledAgents: draftAgents,
        enabledCategories: categories.map((category) => category.id),
      });

      await refreshWorkspaceMutation.mutateAsync({
        workspaceId: ws.branchName,
      });

      showToast?.('Skills & agents deployed successfully to workspace context!', 'success');
    } catch (error) {
      showToast?.(error instanceof Error ? error.message : 'Failed to deploy skills', 'error');
    } finally {
      setIsDeploying(false);
    }
  };

  const filteredSkills = useMemo(() => {
    if (!searchQuery.trim()) return skills;
    const q = searchQuery.toLowerCase();
    return skills.filter(
      (s) =>
        s.title?.toLowerCase().includes(q) ||
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.tags?.some((t) => t.toLowerCase().includes(q)),
    );
  }, [skills, searchQuery]);

  const filteredAgents = useMemo(() => {
    if (!searchQuery.trim()) return agents;
    const q = searchQuery.toLowerCase();
    return agents.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        a.description.toLowerCase().includes(q) ||
        a.category.toLowerCase().includes(q),
    );
  }, [agents, searchQuery]);

  const skillsByCategory = useMemo(() => {
    const acc: Record<string, SkillItem[]> = {};
    for (const cat of categories) {
      acc[cat.id] = filteredSkills.filter((s) => s.category === cat.id);
    }
    return acc;
  }, [categories, filteredSkills]);

  const isLoading = loadingCategories || loadingSkills || loadingAgents || loadingWorkspaceConfig;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-12 gap-3 text-muted-foreground">
        <Spinner />
        <span className="text-sm">Loading workspace skills...</span>
      </div>
    );
  }

  if (workspaceConfigError) {
    return (
      <Empty className="py-12 border border-dashed rounded-xl">
        <EmptyHeader>
          <EmptyTitle>Could not load workspace skills config</EmptyTitle>
          <EmptyDescription>Unable to read .nexusflow/skills.json for this workspace.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Top Banner / Actions Bar */}
      <Card className="p-4 bg-card/70 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/10 text-primary">
            <Boxes className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-foreground">Workspace Skills & Agents</h3>
              <Badge variant="secondary" className="text-[10px] font-mono">
                {enabledSkillSet.size} Skills Active
              </Badge>
              {enabledAgentSet.size > 0 && (
                <Badge variant="secondary" className="text-[10px] font-mono">
                  {enabledAgentSet.size} Agents Active
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Choose which reusable Agent Skills and Codex Agents to deploy into this workspace.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={handleSaveAndDeploy}
            disabled={isDeploying || (!hasUnsavedChanges && enabledSkillSet.size === 0 && enabledAgentSet.size === 0)}
            className="flex items-center gap-1.5 shadow-sm"
          >
            {isDeploying ? <Spinner className="size-3.5" /> : <Sparkles className="size-3.5" />}
            <span>{isDeploying ? 'Deploying…' : hasUnsavedChanges ? 'Save & Deploy Changes' : 'Re-Deploy to Workspace'}</span>
          </Button>

          <Button render={<Link to="/skills" />} variant="outline" size="sm" className="flex items-center gap-1.5">
            <ExternalLink className="size-3.5" />
            <span>Resource Library</span>
          </Button>
        </div>
      </Card>

      {/* Search Input */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Filter skills & agents by keyword..."
          className="pl-9 pr-8 h-8 text-xs bg-card"
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery('')}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Categorized Skills Accordions */}
      <div className="space-y-3">
        {categories.map((category) => {
          const IconComp = ICON_MAP[category.icon || 'boxes'] || Boxes;
          const catSkills = skillsByCategory[category.id] || [];
          if (searchQuery && catSkills.length === 0) return null;

          const isCollapsed = !!collapsedCategories[category.id];
          const allCatEnabled = catSkills.length > 0 && catSkills.every((s) => enabledSkillSet.has(s.id));

          return (
            <div
              key={category.id}
              className="border border-border rounded-xl overflow-hidden bg-card/60 transition-colors"
            >
              {/* Category Header */}
              <div
                role="button"
                tabIndex={0}
                aria-expanded={!isCollapsed}
                onClick={() => toggleCategoryCollapse(category.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    toggleCategoryCollapse(category.id);
                  }
                }}
                className="p-3 flex items-center justify-between cursor-pointer hover:bg-muted/40 transition-colors select-none"
              >
                <div className="flex items-center gap-2.5">
                  <div
                    className="p-1.5 rounded-md text-white shadow-xs flex items-center justify-center"
                    style={{ backgroundColor: category.color || '#3b82f6' }}
                  >
                    <IconComp className="h-3.5 w-3.5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className="font-semibold text-xs text-foreground">{category.name}</h4>
                      <Badge variant="outline" className="text-[9px] px-1 py-0">
                        {catSkills.filter((s) => enabledSkillSet.has(s.id)).length}/{catSkills.length} active
                      </Badge>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                  {catSkills.length > 0 && (
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() => handleToggleCategory(category.id, !allCatEnabled, catSkills)}
                      className="h-6 text-[11px] px-2 text-muted-foreground hover:text-foreground"
                    >
                      {allCatEnabled ? (
                        <CheckSquare className="h-3 w-3 mr-1 text-primary" />
                      ) : (
                        <Square className="h-3 w-3 mr-1" />
                      )}
                      <span>{allCatEnabled ? 'Deselect All' : 'Select All'}</span>
                    </Button>
                  )}
                  <div className="p-0.5 text-muted-foreground">
                    {isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </div>
                </div>
              </div>

              {/* Skills Grid */}
              {!isCollapsed && (
                <div className="p-3 border-t border-border/40 bg-background/50">
                  {catSkills.length === 0 ? (
                    <p className="text-xs text-muted-foreground py-2 text-center">No skills in this category.</p>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                      {catSkills.map((skill) => {
                        const isEnabled = enabledSkillSet.has(skill.id);
                        return (
                          <div
                            key={skill.id}
                            role="button"
                            tabIndex={0}
                            onClick={() => handleToggleSkill(skill.id)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                handleToggleSkill(skill.id);
                              }
                            }}
                            className={cn(
                              'p-3 rounded-lg border text-left cursor-pointer transition-all flex flex-col justify-between select-none shadow-2xs',
                              isEnabled
                                ? 'border-primary/60 bg-primary/5 text-foreground'
                                : 'border-border bg-card/70 text-muted-foreground hover:border-foreground/20 hover:text-foreground',
                            )}
                          >
                            <div className="flex items-start justify-between gap-2 mb-1.5">
                              <div className="flex items-center gap-2 min-w-0">
                                <span
                                  className={cn(
                                    'grid size-4 shrink-0 place-items-center rounded border transition-colors',
                                    isEnabled
                                      ? 'border-primary bg-primary text-primary-foreground'
                                      : 'border-muted-foreground/40 bg-transparent',
                                  )}
                                >
                                  {isEnabled && <Check className="size-3 stroke-[3]" />}
                                </span>
                                <span className="font-mono text-xs font-semibold truncate">
                                  {skill.title || skill.name}
                                </span>
                              </div>
                              <Badge variant="outline" className="text-[9px] px-1 py-0 shrink-0">
                                {skill.custom ? 'Custom' : 'Template'}
                              </Badge>
                            </div>

                            <p className="text-[11px] text-muted-foreground line-clamp-2 leading-relaxed pl-6">
                              {skill.description || 'No description provided.'}
                            </p>

                            {skill.tags && skill.tags.length > 0 && (
                              <div className="mt-2 pl-6 flex items-center gap-1 flex-wrap">
                                {skill.tags.slice(0, 3).map((tag) => (
                                  <span key={tag} className="text-[9px] font-mono text-muted-foreground bg-muted/60 px-1 py-0.2 rounded">
                                    #{tag}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {/* Custom Codex Agents Section */}
        {filteredAgents.length > 0 && (
          <div className="border border-border rounded-xl overflow-hidden bg-card/60 transition-colors">
            <div className="p-3 flex items-center justify-between border-b border-border/40 select-none">
              <div className="flex items-center gap-2.5">
                <div className="p-1.5 rounded-md bg-purple-600 text-white shadow-xs flex items-center justify-center">
                  <Bot className="h-3.5 w-3.5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h4 className="font-semibold text-xs text-foreground">Codex Native Agents</h4>
                    <Badge variant="outline" className="text-[9px] px-1 py-0">
                      {filteredAgents.filter((a) => enabledAgentSet.has(a.id)).length}/{filteredAgents.length} active
                    </Badge>
                  </div>
                </div>
              </div>
            </div>

            <div className="p-3 bg-background/50">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                {filteredAgents.map((agent) => {
                  const isEnabled = enabledAgentSet.has(agent.id);
                  return (
                    <div
                      key={agent.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => handleToggleAgent(agent.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          handleToggleAgent(agent.id);
                        }
                      }}
                      className={cn(
                        'p-3 rounded-lg border text-left cursor-pointer transition-all flex flex-col justify-between select-none shadow-2xs',
                        isEnabled
                          ? 'border-purple-500/60 bg-purple-500/5 text-foreground'
                          : 'border-border bg-card/70 text-muted-foreground hover:border-foreground/20 hover:text-foreground',
                      )}
                    >
                      <div className="flex items-start justify-between gap-2 mb-1.5">
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className={cn(
                              'grid size-4 shrink-0 place-items-center rounded border transition-colors',
                              isEnabled
                                ? 'border-purple-600 bg-purple-600 text-white'
                                : 'border-muted-foreground/40 bg-transparent',
                            )}
                          >
                            {isEnabled && <Check className="size-3 stroke-[3]" />}
                          </span>
                          <span className="font-mono text-xs font-semibold truncate">{agent.name}</span>
                        </div>
                        <Badge variant="secondary" className="text-[9px] px-1 py-0 shrink-0">
                          .codex/agents
                        </Badge>
                      </div>

                      <p className="text-[11px] text-muted-foreground line-clamp-2 leading-relaxed pl-6">
                        {agent.description || 'No description provided.'}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>

      <p className="text-[11px] text-muted-foreground">
        Saving & deploying will write to <code className="font-mono text-xs text-foreground">.nexusflow/skills.json</code> and materialize files into <code className="font-mono text-xs text-foreground">.agents/skills/</code>, <code className="font-mono text-xs text-foreground">.claude/skills/</code>, <code className="font-mono text-xs text-foreground">.codex/skills/</code>, <code className="font-mono text-xs text-foreground">.github/skills/</code>, <code className="font-mono text-xs text-foreground">.cursor/skills/</code>, and <code className="font-mono text-xs text-foreground">.codex/agents/</code>.
      </p>
    </div>
  );
}
