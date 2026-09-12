import { useState, useEffect, type ComponentProps } from 'react';
import {
  RefreshCw,
  MoreVertical,
  Copy,
  Trash2,
  FolderGit2,
  Terminal,
  Code2,
  ChevronDown,
  Sparkles,
  ArrowUpCircle,
  Puzzle,
  LayoutDashboard,
  GitCompare,
  Bot,
  Brain,
  Workflow,
  GitBranch,
  Zap,
  Building2,
  Tag,
  ShieldCheck,
  Edit3,
  Check,
  Plus,
  SlidersHorizontal,
  RotateCcw,
  X,
  type LucideIcon,
} from 'lucide-react';
import { VscVscode, VscVscodeInsiders } from 'react-icons/vsc';
import { AntigravityIcon } from '../components/icons/AntigravityIcon.js';
import type { Feature, WorkspaceStatus, RepoInfo, DomainPack, ResolvedCategoryRules } from '../types.js';
import { API_BASE } from '../lib/apiBase.js';
import { BRAND_NAME, LEGACY_BRAND_NAME } from '../brand.js';

const renderEditorIcon = (id: string, name: string) => {
  const lower = `${id} ${name}`.toLowerCase();
  if (lower.includes('insiders')) {
    return <VscVscodeInsiders size={15} className="text-[#24C05A] shrink-0" />;
  }
  if (lower.includes('code') || lower.includes('vscode')) {
    return <VscVscode size={15} className="text-[#007ACC] shrink-0" />;
  }
  if (lower.includes('antigravity')) {
    return <AntigravityIcon className="size-3.5 shrink-0" />;
  }
  if (lower.includes('cursor')) {
    return <Sparkles size={14} className="text-purple-400 shrink-0" />;
  }
  if (lower.includes('powershell') || lower.includes('pwsh')) {
    return <Terminal size={14} className="text-sky-400 shrink-0" />;
  }
  if (lower.includes('cmd') || lower.includes('command prompt')) {
    return <Terminal size={14} className="text-amber-400 shrink-0" />;
  }
  return <Code2 size={14} className="shrink-0" />;
};

import { Button } from '../components/ui/button.js';
import { Card } from '../components/ui/card.js';
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogPanel,
  DialogFooter,
} from '../components/ui/dialog.js';
import { Input } from '../components/ui/input.js';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '../components/ui/empty.js';
import { Menu, MenuItem, MenuPopup, MenuTrigger } from '../components/ui/menu.js';
import { Spinner } from '../components/ui/spinner.js';
import { Tabs, TabsList, TabsPanel, TabsTab } from '../components/ui/tabs.js';
import { AddRepoPicker } from '../components/AddRepoPicker.js';
import { useWorkspaceLaunchTargets, useWorkspaceSkills, useSkills } from '../lib/api/queries.js';
import { safeCopyToClipboard } from '../lib/clipboard.js';
import { syncMeta, repoName } from '../lib/status.js';
import { apiFetch } from '../lib/api/client.js';
import { cn } from '../lib/utils.js';
import { SessionHistory } from '../features/sessions/SessionHistory.js';
import { useFloatingChat } from '../features/chat/floatingChatStore.js';
import { ChangesViewer } from '../features/changes/ChangesViewer.js';
import { KnowledgeBase } from '../features/knowledge/KnowledgeBase.js';
import { ImplementationPlan } from '../features/plan/ImplementationPlan.js';
import { WorkspaceSkillsTab } from '../features/skills/WorkspaceSkillsTab.js';
import { ChatMarkdown } from '../components/ChatMarkdown.js';

type SubTab = 'overview' | 'sessions' | 'changes' | 'knowledge' | 'skills';

interface TabDef {
  value: SubTab;
  label: string;
  icon: LucideIcon;
}

const TABS: TabDef[] = [
  { value: 'overview', label: 'Command Center', icon: LayoutDashboard },
  { value: 'changes', label: 'Git Diff', icon: GitCompare },
  { value: 'sessions', label: 'AI & Chat', icon: Bot },
  { value: 'knowledge', label: 'Knowledge', icon: Brain },
  { value: 'skills', label: 'Skills', icon: Puzzle },
];

interface WorkspacesPageProps {
  workspaces: Feature[];
  workspaceStatuses: Record<string, WorkspaceStatus>;
  workspacesLoading?: boolean;
  fetchWorkspaces?: () => Promise<void>;
  selectedId: string | null;
  subTab: SubTab;
  onSelect?: (id: string) => void;
  onSelectTab: (id: string, tab: SubTab) => void;
  handleCopyPrompt: (ws: Feature) => void;
  handleDeleteWorkspace: (wsName: string) => Promise<void>;
  deleteWsLoading: string | null;
  repos: RepoInfo[];
  addRepoLoading: boolean;
  handleAddRepo: (wsName: string, repoPath: string) => Promise<void>;
  showToast?: (message: string, type?: 'success' | 'error' | 'info', duration?: number) => void;
  sessionProps: Omit<ComponentProps<typeof SessionHistory>, 'ws'>;
  changesProps: Omit<ComponentProps<typeof ChangesViewer>, 'ws'>;
  knowledgeProps: Omit<ComponentProps<typeof KnowledgeBase>, 'ws'>;
  planProps: ComponentProps<typeof ImplementationPlan>;
}

export function WorkspacesPage(props: WorkspacesPageProps) {
  const {
    workspaces,
    workspaceStatuses,
    selectedId,
    subTab,
    onSelectTab,
    handleCopyPrompt,
    handleDeleteWorkspace,
    deleteWsLoading,
    repos,
    addRepoLoading,
    handleAddRepo,
    showToast,
    sessionProps,
    changesProps,
    knowledgeProps,
    planProps,
  } = props;

  const selected = workspaces.find((w) => w.branchName === selectedId) ?? null;
  const selectedMode = selected?.mode ?? 'worktree';
  const { open: openFloatingChat } = useFloatingChat();

  const [isLegacy, setIsLegacy] = useState(false);
  const [migrating, setMigrating] = useState(false);

  useEffect(() => {
    if (!selected?.branchName) {
      setIsLegacy(false);
      return;
    }
    let active = true;
    fetch(`${API_BASE}/api/workspace/${encodeURIComponent(selected.branchName)}/migration-status`)
      .then((res) => (res.ok ? res.json() : { isLegacy: false }))
      .then((data) => {
        if (active) setIsLegacy(Boolean(data?.isLegacy));
      })
      .catch(() => {
        if (active) setIsLegacy(false);
      });
    return () => {
      active = false;
    };
  }, [selected?.branchName]);

  const handleMigrateWorkspace = async () => {
    if (!selected?.branchName || migrating) return;
    setMigrating(true);
    try {
      const res = await fetch(`${API_BASE}/api/workspace/${encodeURIComponent(selected.branchName)}/migrate`, {
        method: 'POST',
      });
      if (!res.ok) throw new Error('Migration failed');
      showToast?.(`Workspace successfully upgraded to native ${BRAND_NAME}!`, 'success');
      setIsLegacy(false);
      props.fetchWorkspaces?.();
    } catch (e: any) {
      showToast?.(e.message || 'Failed to migrate workspace', 'error');
    } finally {
      setMigrating(false);
    }
  };

  // Active skills in this workspace
  const workspaceSkillsConfig = useWorkspaceSkills(selected?.branchName ?? null).data;
  const { data: allSkills = [] } = useSkills(selected?.branchName);
  const activeSkills = allSkills.filter((s) => workspaceSkillsConfig?.enabledSkills?.includes(s.id));

  // Enterprise domain packs, hierarchical categories, and specifications
  const [domainData, setDomainData] = useState<ResolvedCategoryRules | null>(null);
  const [availableDomainPacks, setAvailableDomainPacks] = useState<DomainPack[]>([]);
  const [editingSpec, setEditingSpec] = useState(false);
  const [specInput, setSpecInput] = useState('');
  const [savingSpec, setSavingSpec] = useState(false);

  // New Category / Trait dialog state
  const [showCreateTagModal, setShowCreateTagModal] = useState(false);
  const [newTagName, setNewTagName] = useState('');
  const [newTagId, setNewTagId] = useState('');
  const [newTagDescription, setNewTagDescription] = useState('');
  const [newTagType, setNewTagType] = useState<'vertical' | 'trait'>('vertical');
  const [newTagParent, setNewTagParent] = useState('');
  const [newTagVerifyCmd, setNewTagVerifyCmd] = useState('');
  const [newTagRules, setNewTagRules] = useState('');
  const [newTagMicroserviceName, setNewTagMicroserviceName] = useState('');
  const [newTagMicroserviceTarget, setNewTagMicroserviceTarget] = useState<'edit' | 'reference'>('edit');
  const [savingNewTag, setSavingNewTag] = useState(false);

  // Inspect / Edit Existing Category / Trait dialog state
  const [inspectingTag, setInspectingTag] = useState<DomainPack | null>(null);
  const [inspectTagName, setInspectTagName] = useState('');
  const [inspectTagDescription, setInspectTagDescription] = useState('');
  const [inspectTagType, setInspectTagType] = useState<'vertical' | 'trait'>('vertical');
  const [inspectTagParent, setInspectTagParent] = useState('');
  const [inspectTagVerifyCmd, setInspectTagVerifyCmd] = useState('');
  const [inspectTagRules, setInspectTagRules] = useState('');
  const [inspectTagMicroservices, setInspectTagMicroservices] = useState<Array<{ name: string; target: 'edit' | 'reference' }>>([]);
  const [inspectNewMsName, setInspectNewMsName] = useState('');
  const [inspectNewMsTarget, setInspectNewMsTarget] = useState<'edit' | 'reference'>('edit');
  const [inspectTagSkills, setInspectTagSkills] = useState<string[]>([]);
  const [inspectNewSkill, setInspectNewSkill] = useState('');
  const [inspectTagTags, setInspectTagTags] = useState('');
  const [savingTagDetails, setSavingTagDetails] = useState(false);
  const [deletingTagDetails, setDeletingTagDetails] = useState(false);

  useEffect(() => {
    if (!selected) {
      setDomainData(null);
      return;
    }
    setSpecInput(selected.description || '');
    setEditingSpec(false);
    void fetchDomainData(selected.branchName);
  }, [selected?.branchName]);

  useEffect(() => {
    void apiFetch<{ domainPacks: DomainPack[] }>('/api/enterprise/domain-packs')
      .then((res) => {
        if (res?.domainPacks) setAvailableDomainPacks(res.domainPacks);
      })
      .catch(() => {});
  }, []);

  const fetchDomainData = async (wsId: string) => {
    try {
      const res = await apiFetch<any>(`/api/workspace/${encodeURIComponent(wsId)}/domain-packs`);
      if (res) setDomainData(res);
    } catch {
      setDomainData(null);
    }
  };

  const toggleDomainPack = async (packId: string) => {
    if (!selected) return;
    const current = new Set(domainData?.assignedDomainPackIds || selected.domainPacks || []);
    if (current.has(packId)) {
      current.delete(packId);
    } else {
      current.add(packId);
    }
    const nextPacks = Array.from(current);
    try {
      await apiFetch(`/api/workspace/${encodeURIComponent(selected.branchName)}/domain-packs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          organizationId: selected.organizationId || 'hogia',
          domainPacks: nextPacks,
        }),
      });
      await fetchDomainData(selected.branchName);
      if (props.fetchWorkspaces) await props.fetchWorkspaces();
      showToast?.(`Updated domain packs (${nextPacks.length} active)`, 'success');
    } catch {
      showToast?.('Failed to update domain packs', 'error');
    }
  };

  const handleSaveSpec = async () => {
    if (!selected || !specInput.trim()) return;
    setSavingSpec(true);
    try {
      const res = await apiFetch<any>(`/api/workspace/${encodeURIComponent(selected.branchName)}/update-spec`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: specInput.trim(),
          autoMatchDomains: true,
        }),
      });
      setEditingSpec(false);
      await fetchDomainData(selected.branchName);
      if (props.fetchWorkspaces) await props.fetchWorkspaces();
      if (res?.newlyMatched?.length > 0) {
        showToast?.(`Specification saved! Auto-attached domain packs: ${res.newlyMatched.join(', ')}`, 'success');
      } else {
        showToast?.('Specification updated and context refreshed', 'success');
      }
    } catch {
      showToast?.('Failed to update specification', 'error');
    } finally {
      setSavingSpec(false);
    }
  };

  const handleCreateDomainPack = async () => {
    if (!newTagId.trim() || !newTagName.trim()) return;
    setSavingNewTag(true);
    try {
      const rulesArray = newTagRules
        .split('\n')
        .map((r) => r.trim())
        .filter(Boolean);
      const microservicesArray = newTagMicroserviceName.trim()
        ? [{ name: newTagMicroserviceName.trim(), target: newTagMicroserviceTarget }]
        : undefined;

      await apiFetch('/api/enterprise/domain-packs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: newTagId.trim().toLowerCase(),
          name: newTagName.trim(),
          description: newTagDescription.trim(),
          categoryType: newTagType,
          parent: newTagType === 'vertical' && newTagParent.trim() ? newTagParent.trim() : undefined,
          verifyCommand: newTagVerifyCmd.trim() || undefined,
          rules: rulesArray.length > 0 ? rulesArray : undefined,
          microservices: microservicesArray,
          tags: [newTagId.trim().toLowerCase(), ...newTagName.trim().toLowerCase().split(/\s+/).filter(Boolean)],
        }),
      });

      const res = await apiFetch<{ domainPacks: DomainPack[] }>('/api/enterprise/domain-packs');
      if (res?.domainPacks) setAvailableDomainPacks(res.domainPacks);

      if (selected) {
        await toggleDomainPack(newTagId.trim().toLowerCase());
      }

      setShowCreateTagModal(false);
      setNewTagId('');
      setNewTagName('');
      setNewTagDescription('');
      setNewTagParent('');
      setNewTagVerifyCmd('');
      setNewTagRules('');
      setNewTagMicroserviceName('');
      showToast?.(`Created category "${newTagName}" and attached to workspace!`, 'success');
    } catch (err: any) {
      showToast?.(err.message || 'Failed to create category tag', 'error');
    } finally {
      setSavingNewTag(false);
    }
  };

  const handleOpenTagDetails = (tag: DomainPack) => {
    setInspectingTag(tag);
    setInspectTagName(tag.name || '');
    setInspectTagDescription(tag.description || '');
    setInspectTagType(tag.categoryType || 'vertical');
    setInspectTagParent(tag.parent || '');
    setInspectTagVerifyCmd(tag.verifyCommand || '');
    setInspectTagRules(tag.rules ? tag.rules.join('\n') : '');
    const msList: Array<{ name: string; target: 'edit' | 'reference' }> = tag.microservices
      ? tag.microservices.map((m) => ({ name: m.name, target: m.target || 'edit' }))
      : tag.defaultRepos
        ? tag.defaultRepos.map((r) => ({ name: r, target: 'edit' as const }))
        : [];
    setInspectTagMicroservices(msList);
    setInspectNewMsName('');
    setInspectNewMsTarget('edit');
    setInspectTagSkills(tag.skills ? [...tag.skills] : []);
    setInspectNewSkill('');
    setInspectTagTags(tag.tags ? tag.tags.join(', ') : '');
  };

  const handleSaveTagDetails = async () => {
    if (!inspectingTag || !inspectTagName.trim()) return;
    setSavingTagDetails(true);
    try {
      const rulesArray = inspectTagRules
        .split('\n')
        .map((r) => r.trim())
        .filter(Boolean);
      const tagsArray = inspectTagTags
        .split(',')
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean);

      const payload = {
        name: inspectTagName.trim(),
        description: inspectTagDescription.trim(),
        categoryType: inspectTagType,
        parent: inspectTagType === 'vertical' && inspectTagParent.trim() ? inspectTagParent.trim() : undefined,
        verifyCommand: inspectTagVerifyCmd.trim() || undefined,
        rules: rulesArray.length > 0 ? rulesArray : undefined,
        microservices: inspectTagMicroservices.length > 0 ? inspectTagMicroservices : undefined,
        skills: inspectTagSkills.length > 0 ? inspectTagSkills : undefined,
        tags: tagsArray.length > 0 ? tagsArray : [inspectingTag.id],
      };

      await apiFetch(`/api/enterprise/domain-packs/${encodeURIComponent(inspectingTag.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const res = await apiFetch<{ domainPacks: DomainPack[] }>('/api/enterprise/domain-packs');
      if (res?.domainPacks) setAvailableDomainPacks(res.domainPacks);
      if (selected) {
        await fetchDomainData(selected.branchName);
        if (props.fetchWorkspaces) await props.fetchWorkspaces();
      }

      showToast?.(`Tag "${inspectTagName.trim()}" updated successfully`, 'success');
      setInspectingTag(null);
    } catch (err: any) {
      showToast?.(err.message || 'Failed to update tag', 'error');
    } finally {
      setSavingTagDetails(false);
    }
  };

  const handleDeleteOrResetTag = async () => {
    if (!inspectingTag) return;
    const isOverriddenBuiltin = !inspectingTag.isTemplate && ['economy', 'transport', 'tax', 'payroll', 'fintech', 'security', 'audit', 'performance', 'testing', 'accessibility', 'offline'].includes(inspectingTag.id);
    const actionLabel = isOverriddenBuiltin ? 'reset to built-in template' : 'delete';
    if (!window.confirm(`Are you sure you want to ${actionLabel} the tag "${inspectingTag.name}"?`)) {
      return;
    }
    setDeletingTagDetails(true);
    try {
      await apiFetch(`/api/enterprise/domain-packs/${encodeURIComponent(inspectingTag.id)}`, {
        method: 'DELETE',
      });

      const res = await apiFetch<{ domainPacks: DomainPack[] }>('/api/enterprise/domain-packs');
      if (res?.domainPacks) setAvailableDomainPacks(res.domainPacks);

      if (selected) {
        const currentPacks = domainData?.assignedDomainPackIds || selected.domainPacks || [];
        if (!isOverriddenBuiltin && currentPacks.includes(inspectingTag.id)) {
          const updatedPacks = currentPacks.filter((p) => p !== inspectingTag.id);
          await apiFetch(`/api/workspace/${encodeURIComponent(selected.branchName)}/domain-packs`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              organizationId: selected.organizationId || 'hogia',
              domainPacks: updatedPacks,
            }),
          });
        }
        await fetchDomainData(selected.branchName);
        if (props.fetchWorkspaces) await props.fetchWorkspaces();
      }

      showToast?.(isOverriddenBuiltin ? `Reset "${inspectingTag.name}" to built-in defaults` : `Deleted tag "${inspectingTag.name}"`, 'success');
      setInspectingTag(null);
    } catch (err: any) {
      showToast?.(err.message || 'Failed to delete/reset tag', 'error');
    } finally {
      setDeletingTagDetails(false);
    }
  };

  const repoRows = selected
    ? selected.repos.map((rp) => {
        const name = repoName(rp);
        const change = changesProps.gitChanges?.find((c: { repoName: string; files?: unknown[] }) => c.repoName === name);
        const changedCount: number | null = change ? change.files?.length ?? 0 : null;
        return { name, path: rp, changedCount };
      })
    : [];

  const availableRepos = selected ? repos.filter((r) => !selected.repos.includes(r.path)) : [];

  const launchTargets = useWorkspaceLaunchTargets();
  const [openingEditor, setOpeningEditor] = useState<string | null>(null);

  const availableEditors = launchTargets.data?.filter((t) => t.kind === 'editor' && t.available) ?? [];
  const primaryEditor = availableEditors.find((e) => e.id === 'vscode-insiders')
    || availableEditors.find((e) => e.id === 'vscode')
    || availableEditors[0];

  const handleOpenEditor = async (targetId: string) => {
    if (openingEditor || !selected) return;
    setOpeningEditor(targetId);
    try {
      await apiFetch(`/api/workspace/${encodeURIComponent(selected.branchName)}/launch`, {
        method: 'POST',
        body: JSON.stringify({ targetId }),
      });
      showToast?.(`Opened workspace in ${targetId}.`, 'success');
    } catch (e) {
      showToast?.(`Failed to open ${targetId}: ${e instanceof Error ? e.message : String(e)}`, 'error');
    } finally {
      setOpeningEditor(null);
    }
  };

  const renderInspector = () => {
    if (!selected) return null;
    const st = workspaceStatuses[selected.branchName];
    const sync = selectedMode === 'in-place' ? null : (st ? syncMeta(st.syncStatus) : null);
    const totalChangedFiles = st?.changedFiles ?? 0;

    return (
      <div className="flex flex-col min-w-0 pb-12">
        {/* Workspace Hero Cockpit Header */}
        <div className="border-b border-border/80 bg-card/75 backdrop-blur-md px-6 py-5 shadow-xs">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            {/* Left: Branch Title, Badges, and Live Telemetry */}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2.5">
                <div className="grid size-7 place-items-center rounded-md bg-primary/15 text-primary border border-primary/25 shrink-0">
                  <GitBranch size={15} />
                </div>
                <h1 className="truncate font-mono text-base sm:text-lg font-extrabold text-foreground tracking-tight" title={selected.branchName}>
                  {selected.branchName}
                </h1>
                <button
                  type="button"
                  onClick={async () => {
                    const copied = await safeCopyToClipboard(selected.branchName);
                    if (copied) showToast?.('Copied branch name to clipboard.', 'success');
                  }}
                  className="text-muted-foreground hover:text-primary transition-colors p-1 rounded-md hover:bg-accent cursor-pointer"
                  title="Copy branch name"
                >
                  <Copy size={13} />
                </button>
                <span className="inline-flex items-center rounded-md border border-primary/20 bg-primary/10 px-2 py-0.5 font-mono text-[10px] font-bold text-primary uppercase tracking-wider">
                  {selectedMode === 'in-place' ? 'In-Place Mode' : 'Worktree Mode'}
                </span>
              </div>

              {/* High-tech Sub-strip with live status indicators */}
              <div className="mt-2.5 flex flex-wrap items-center gap-3 font-mono text-[11px] text-muted-foreground">
                <span className="flex items-center gap-1.5 text-foreground/80 font-medium">
                  <FolderGit2 size={13} className="text-muted-foreground" />
                  {selected.repos.length} {selected.repos.length === 1 ? 'repo' : 'repos'}
                </span>
                <span>•</span>
                {totalChangedFiles > 0 ? (
                  <button
                    type="button"
                    onClick={() => onSelectTab(selected.branchName, 'changes')}
                    className="flex items-center gap-1.5 text-amber-400 font-semibold hover:underline cursor-pointer"
                  >
                    <span className="size-2 rounded-full bg-amber-400 animate-pulse" />
                    {totalChangedFiles} modified files
                  </button>
                ) : (
                  <span className="flex items-center gap-1.5 text-emerald-400 font-medium">
                    <span className="size-2 rounded-full bg-emerald-400" />
                    Clean worktrees
                  </span>
                )}
                <span>•</span>
                <span className="text-muted-foreground/80">Created {new Date(selected.createdAt).toLocaleDateString()}</span>
                {sync && (
                  <>
                    <span>•</span>
                    <span className="flex items-center gap-1.5 text-primary font-medium">
                      <RefreshCw size={11} className="animate-spin-slow" /> {sync.label}
                    </span>
                  </>
                )}
              </div>
            </div>

            {/* Right: Quick Action Controls */}
            <div className="flex items-center gap-2 shrink-0">
              {primaryEditor && (
                availableEditors.length > 1 ? (
                  <div className="inline-flex h-9 items-center rounded-lg border border-border bg-card shadow-xs hover:border-primary/40 transition-colors">
                    <button
                      type="button"
                      disabled={Boolean(openingEditor)}
                      onClick={() => void handleOpenEditor(primaryEditor.id)}
                      title={`Open workspace in ${primaryEditor.name}`}
                      className="inline-flex h-full items-center gap-2 px-3.5 text-xs font-bold text-foreground hover:bg-accent transition-colors cursor-pointer rounded-l-lg"
                    >
                      {openingEditor === primaryEditor.id ? <Spinner className="size-3.5" /> : renderEditorIcon(primaryEditor.id, primaryEditor.name)}
                      <span>{primaryEditor.name}</span>
                    </button>
                    <Menu>
                      <MenuTrigger aria-label="Choose editor" className="inline-flex h-full w-7 items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent border-l border-border transition-colors cursor-pointer rounded-r-lg">
                        <ChevronDown size={13} />
                      </MenuTrigger>
                      <MenuPopup align="end" className="w-56">
                        <div className="px-2.5 py-1 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                          Open Workspace In
                        </div>
                        {availableEditors.map((ed) => (
                          <MenuItem
                            key={ed.id}
                            onClick={() => void handleOpenEditor(ed.id)}
                            className={cn(
                              'flex items-center justify-between text-xs py-2',
                              ed.id === primaryEditor.id && 'font-bold text-primary bg-primary/5'
                            )}
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              {renderEditorIcon(ed.id, ed.name)}
                              <span className="truncate">{ed.name}</span>
                            </div>
                            {ed.id === primaryEditor.id && <span className="text-[10px] text-primary font-mono font-bold">(default)</span>}
                          </MenuItem>
                        ))}
                      </MenuPopup>
                    </Menu>
                  </div>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={Boolean(openingEditor)}
                    onClick={() => void handleOpenEditor(primaryEditor.id)}
                    title={`Open workspace in ${primaryEditor.name}`}
                    className="font-bold h-9 gap-2"
                  >
                    {openingEditor === primaryEditor.id ? <Spinner className="size-3.5" /> : renderEditorIcon(primaryEditor.id, primaryEditor.name)}
                    <span>{primaryEditor.name}</span>
                  </Button>
                )
              )}

              {/* Fast Copy Prompt Button */}
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleCopyPrompt(selected)}
                aria-label="Copy Context"
                title="Copy AI Context prompt for external LLM"
                className="h-9 gap-1.5 text-xs font-semibold"
              >
                <Copy size={13} />
                <span className="hidden sm:inline">Copy Context</span>
              </Button>

              {/* More Actions Menu */}
              <Menu>
                <MenuTrigger aria-label="Workspace actions" className="grid size-9 place-items-center rounded-lg border border-border bg-card text-muted-foreground hover:text-foreground hover:bg-accent transition-colors cursor-pointer shadow-xs">
                  <MoreVertical size={15} />
                </MenuTrigger>
                <MenuPopup align="end" className="w-52">
                  <MenuItem onClick={() => handleCopyPrompt(selected)} className="flex items-center gap-2 text-xs py-2">
                    <Copy size={13} /> <span>Copy AI Context</span>
                  </MenuItem>
                  <MenuItem
                    onClick={() => void handleDeleteWorkspace(selected.branchName)}
                    disabled={deleteWsLoading === selected.branchName}
                    className="flex items-center gap-2 text-xs py-2 text-destructive hover:bg-destructive/10"
                  >
                    <Trash2 size={13} />
                    <span>{deleteWsLoading === selected.branchName ? 'Deleting…' : 'Delete Workspace'}</span>
                  </MenuItem>
                </MenuPopup>
              </Menu>
            </div>
          </div>
        </div>

        {/* Tab Navigation & Content Container */}
        <div className="px-6 pt-5">
          {/* Legacy Migration Alert Banner */}
          {isLegacy && (
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/30 bg-gradient-to-r from-amber-500/15 via-orange-500/10 to-transparent p-3 backdrop-blur-md shadow-xs">
              <div className="flex items-center gap-2.5 text-xs text-amber-200">
                <Sparkles size={16} className="text-amber-400 shrink-0 animate-pulse" />
                <span>
                  <strong className="font-semibold text-amber-300">Legacy {LEGACY_BRAND_NAME} Workspace:</strong> Upgrade to native {BRAND_NAME} manifest and synchronized artifacts.
                </span>
              </div>
              <button
                type="button"
                onClick={handleMigrateWorkspace}
                disabled={migrating}
                className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 px-3 py-1.5 text-xs font-bold text-white shadow-sm transition-all active:scale-95 disabled:opacity-50 cursor-pointer"
              >
                <ArrowUpCircle size={14} className={migrating ? 'animate-spin' : ''} />
                {migrating ? 'Upgrading...' : `Migrate to ${BRAND_NAME}`}
              </button>
            </div>
          )}

          <Tabs
            value={subTab}
            onValueChange={(v) => typeof v === 'string' && onSelectTab(selected.branchName, v as SubTab)}
            className="mb-6"
          >
            {/* Rich Luxury Segmented Menu Bar */}
            <TabsList className="w-full flex-nowrap overflow-x-auto justify-start gap-1.5 p-1.5 rounded-xl border border-border/70 bg-card/60 backdrop-blur-md shadow-xs">
              {TABS.map((tab) => {
                const Icon = tab.icon;
                const isActive = subTab === tab.value;
                let badge: React.ReactNode = null;

                if (tab.value === 'changes' && totalChangedFiles > 0) {
                  badge = (
                    <span className="ml-1.5 inline-flex items-center justify-center rounded-full bg-amber-500/20 px-1.5 py-0.2 text-[10px] font-mono font-bold text-amber-400">
                      {totalChangedFiles}
                    </span>
                  );
                } else if (tab.value === 'skills' && activeSkills.length > 0) {
                  badge = (
                    <span className="ml-1.5 inline-flex items-center justify-center rounded-full bg-primary/20 px-1.5 py-0.2 text-[10px] font-mono font-bold text-primary">
                      {activeSkills.length}
                    </span>
                  );
                }

                return (
                  <TabsTab
                    key={tab.value}
                    value={tab.value}
                    className={cn(
                      'flex shrink-0 items-center gap-2 px-3.5 py-2 text-xs font-bold rounded-lg transition-all cursor-pointer',
                      isActive
                        ? 'bg-card text-foreground shadow-xs border border-primary/30 text-primary ring-1 ring-primary/20'
                        : 'text-muted-foreground hover:text-foreground hover:bg-accent/70'
                    )}
                  >
                    <Icon size={14} className={cn('shrink-0', isActive ? 'text-primary' : 'text-muted-foreground')} />
                    <span>{tab.label}</span>
                    {badge}
                  </TabsTab>
                );
              })}
            </TabsList>

            {/* Tab Panels */}
            <TabsPanel value={subTab} className="animate-fade-in pt-4">
              {subTab === 'overview' && (
                <div className="flex flex-col gap-6">
                  {/* HIGH-DENSITY TELEMETRY STRIP */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {/* Stat 1: Git Status */}
                    <div
                      onClick={() => onSelectTab(selected.branchName, 'changes')}
                      className="px-4 py-3 rounded-xl border border-border/80 bg-card/70 hover:bg-card hover:border-primary/40 transition-all cursor-pointer shadow-xs flex items-center justify-between"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className="grid size-8 place-items-center rounded-lg bg-primary/10 text-primary shrink-0 border border-primary/20">
                          <GitCompare size={14} />
                        </span>
                        <div className="min-w-0">
                          <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Git Status</div>
                          <div className="text-sm font-extrabold font-mono text-foreground truncate">
                            {totalChangedFiles > 0 ? (
                              <span className="text-amber-400">{totalChangedFiles} Modified</span>
                            ) : (
                              <span className="text-emerald-400">Clean Tree</span>
                            )}
                          </div>
                        </div>
                      </div>
                      <span className="text-[10px] font-mono text-muted-foreground">{selected.repos.length} {selected.repos.length === 1 ? 'repo' : 'repos'}</span>
                    </div>

                    {/* Stat 2: Flow Mode */}
                    <div className="px-4 py-3 rounded-xl border border-border/80 bg-card/70 shadow-xs flex items-center justify-between">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className="grid size-8 place-items-center rounded-lg bg-primary/10 text-primary shrink-0 border border-primary/20">
                          <Workflow size={14} />
                        </span>
                        <div className="min-w-0">
                          <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Flow Mode</div>
                          <div className="text-sm font-extrabold text-foreground capitalize flex items-center gap-1.5 truncate">
                            <span className="size-1.5 rounded-full bg-emerald-400 animate-pulse shrink-0" />
                            {selected.flowType ? selected.flowType.replace('-', ' ') : 'Feature Flow'}
                          </div>
                        </div>
                      </div>
                      <span className="text-[10px] font-mono text-muted-foreground capitalize">{selectedMode}</span>
                    </div>

                    {/* Stat 3: AI Assistant */}
                    <div
                      onClick={() => onSelectTab(selected.branchName, 'sessions')}
                      className="px-4 py-3 rounded-xl border border-border/80 bg-card/70 hover:bg-card hover:border-primary/40 transition-all cursor-pointer shadow-xs flex items-center justify-between"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className="grid size-8 place-items-center rounded-lg bg-primary/10 text-primary shrink-0 border border-primary/20">
                          <Bot size={14} />
                        </span>
                        <div className="min-w-0">
                          <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">AI Assistant</div>
                          <div className="text-sm font-extrabold text-foreground capitalize truncate">
                            {selected.assistants[0] || 'Antigravity'}
                          </div>
                        </div>
                      </div>
                      <span className="text-[10px] font-mono text-muted-foreground">Ready</span>
                    </div>

                    {/* Stat 4: Attached Skills */}
                    <div
                      onClick={() => onSelectTab(selected.branchName, 'skills')}
                      className="px-4 py-3 rounded-xl border border-border/80 bg-card/70 hover:bg-card hover:border-primary/40 transition-all cursor-pointer shadow-xs flex items-center justify-between"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className="grid size-8 place-items-center rounded-lg bg-primary/10 text-primary shrink-0 border border-primary/20">
                          <Puzzle size={14} />
                        </span>
                        <div className="min-w-0">
                          <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Skills Active</div>
                          <div className="text-sm font-extrabold font-mono text-foreground truncate">
                            {activeSkills.length} <span className="text-xs font-semibold text-muted-foreground">toolkits</span>
                          </div>
                        </div>
                      </div>
                      <span className="text-[10px] font-mono text-muted-foreground">Manage</span>
                    </div>
                  </div>

                  {/* MAIN COMMAND CENTER: 2-COLUMN UNIFIED COCKPIT */}
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                    {/* PRIMARY COLUMN (7 cols): FLOW PIPELINE & IMPLEMENTATION PLAN */}
                    <div className="lg:col-span-7 space-y-6">
                      <ImplementationPlan workspaceId={selected.branchName} {...planProps} />
                    </div>

                    {/* CONTEXT & OPERATIONS COLUMN (5 cols) */}
                    <div className="lg:col-span-5 space-y-6">
                      {/* SECTION: MAPPED REPOSITORIES LIVE MATRIX */}
                      <Card className="border-border/80 bg-card/70 backdrop-blur-md rounded-xl overflow-hidden shadow-xs">
                        <div className="flex items-center justify-between p-4 border-b border-border/60 bg-muted/20">
                          <div className="flex items-center gap-2.5">
                            <FolderGit2 size={16} className="text-primary" />
                            <h3 className="text-xs font-extrabold uppercase tracking-wider text-foreground">
                              Mapped Repositories ({selected.repos.length})
                            </h3>
                          </div>
                          {availableRepos.length > 0 && (
                            <AddRepoPicker
                              repos={availableRepos}
                              disabled={addRepoLoading}
                              onAdd={(repoPath: string) => {
                                if (
                                  window.confirm(
                                    `Add repository "${repoName(repoPath)}" to this workspace?\nThis creates a new git worktree and re-runs analysis.`,
                                  )
                                ) {
                                  void handleAddRepo(selected.branchName, repoPath);
                                }
                              }}
                            />
                          )}
                        </div>

                        <div className="divide-y divide-border/60">
                          {repoRows.map((r) => (
                            <div key={r.name} className="flex items-center justify-between p-3.5 hover:bg-accent/40 transition-colors text-xs">
                              <div className="flex items-center gap-3 min-w-0">
                                <span
                                  className={cn(
                                    'size-2.5 rounded-full shrink-0 shadow-xs',
                                    r.changedCount === null ? 'bg-muted-foreground' : r.changedCount > 0 ? 'bg-amber-400 animate-pulse' : 'bg-emerald-400',
                                  )}
                                  title={r.changedCount === null ? 'Status unknown' : r.changedCount > 0 ? `${r.changedCount} uncommitted changes` : 'Clean'}
                                />
                                <div className="min-w-0">
                                  <div className="font-mono font-bold text-foreground text-xs sm:text-sm truncate">
                                    {r.name}
                                  </div>
                                  <div className="font-mono text-[10px] text-muted-foreground/80 truncate max-w-xs">
                                    {r.path}
                                  </div>
                                </div>
                              </div>

                              <div className="flex items-center gap-2 shrink-0">
                                <span className={cn(
                                  'font-mono text-[10px] font-semibold px-2 py-0.5 rounded-md border',
                                  r.changedCount === null
                                    ? 'border-border bg-muted/60 text-muted-foreground'
                                    : r.changedCount > 0
                                    ? 'border-amber-500/30 bg-amber-500/10 text-amber-400'
                                    : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                                )}>
                                  {r.changedCount === null ? '—' : r.changedCount > 0 ? `${r.changedCount} mod` : 'Clean'}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </Card>

                      {/* SECTION: ENTERPRISE CONTEXT, DOMAIN PACKS & FEATURE SPEC */}
                      <Card className="p-4 border-border/80 bg-card/70 backdrop-blur-md rounded-xl shadow-xs space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Zap size={14} className="text-primary" />
                            <h4 className="text-xs font-extrabold uppercase tracking-wider text-foreground">
                              Feature Specification & Context
                            </h4>
                          </div>
                          {!editingSpec ? (
                            <Button
                              size="xs"
                              variant="ghost"
                              onClick={() => {
                                setSpecInput(selected.description || '');
                                setEditingSpec(true);
                              }}
                              className="h-6 px-2 text-[11px] gap-1 text-muted-foreground hover:text-foreground"
                            >
                              <Edit3 size={11} />
                              <span>Edit Spec</span>
                            </Button>
                          ) : (
                            <div className="flex items-center gap-1.5">
                              <Button
                                size="xs"
                                variant="ghost"
                                onClick={() => setEditingSpec(false)}
                                className="h-6 px-2 text-[11px] text-muted-foreground"
                                disabled={savingSpec}
                              >
                                Cancel
                              </Button>
                              <Button
                                size="xs"
                                variant="default"
                                onClick={() => void handleSaveSpec()}
                                className="h-6 px-2.5 text-[11px] gap-1 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold"
                                disabled={savingSpec}
                              >
                                {savingSpec ? <Spinner size="sm" /> : <Check size={11} />}
                                <span>Save & Match</span>
                              </Button>
                            </div>
                          )}
                        </div>

                        {/* ENTERPRISE ORGANIZATION & DOMAIN PACK BADGES */}
                        <div className="space-y-2 pt-1">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex flex-wrap items-center gap-1.5">
                              {/* Organization Root Badge (if configured) */}
                              {domainData?.organization && (
                                <div
                                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold border border-purple-500/30 bg-purple-500/10 text-purple-300 shadow-xs"
                                  title={`Universal Root Conventions: ${domainData.organization.name}. Commit pattern: ${domainData.organization.commitMessagePattern}`}
                                >
                                  <Building2 size={11} className="text-purple-400 shrink-0" />
                                  <span>{domainData.organization.name} Root</span>
                                  <span className="text-[9px] px-1 py-0.2 rounded bg-purple-500/20 text-purple-200 font-mono">Conventions</span>
                                </div>
                              )}

                              {/* Subsystem Verticals (Grouped with Children) */}
                              {availableDomainPacks
                                .filter((p) => p.categoryType !== 'trait' && !p.parent)
                                .map((root) => {
                                  const isRootAssigned = (domainData?.assignedDomainPackIds || selected.domainPacks || []).includes(root.id);
                                  const children = availableDomainPacks.filter((c) => c.parent === root.id);
                                  return (
                                    <div key={root.id} className="inline-flex items-center rounded-lg border border-border/60 bg-muted/20 p-0.5 gap-1">
                                      <div className="inline-flex items-center">
                                        <button
                                          type="button"
                                          onClick={() => void toggleDomainPack(root.id)}
                                          className={cn(
                                            'inline-flex items-center gap-1 px-2 py-0.5 rounded-l-md text-xs font-medium transition-all cursor-pointer',
                                            isRootAssigned
                                              ? 'bg-emerald-500/20 text-emerald-300 font-semibold shadow-xs'
                                              : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
                                          )}
                                          title={`${root.name}: ${root.description} (Click to toggle)`}
                                        >
                                          <Tag size={10} className={isRootAssigned ? 'text-emerald-400' : 'text-muted-foreground'} />
                                          <span>{root.name}</span>
                                          {!root.isTemplate && (
                                            <span className="text-[8px] px-1 py-0.2 rounded bg-amber-500/20 text-amber-300 font-mono">custom</span>
                                          )}
                                          {isRootAssigned ? (
                                            <span className="size-1.5 rounded-full bg-emerald-400" />
                                          ) : (
                                            <Plus size={10} className="opacity-50" />
                                          )}
                                        </button>
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            handleOpenTagDetails(root);
                                          }}
                                          className={cn(
                                            'px-1 py-1 rounded-r-md text-muted-foreground/70 hover:text-foreground hover:bg-muted/60 transition-colors cursor-pointer',
                                            isRootAssigned ? 'bg-emerald-500/20 text-emerald-300/80 hover:text-emerald-200' : '',
                                          )}
                                          title={`Inspect & edit ${root.name} details`}
                                          aria-label={`Inspect & edit ${root.name} details`}
                                        >
                                          <SlidersHorizontal size={10} />
                                        </button>
                                      </div>
                                      {children.map((child) => {
                                        const isChildAssigned = (domainData?.assignedDomainPackIds || selected.domainPacks || []).includes(child.id);
                                        return (
                                          <div key={child.id} className="inline-flex items-center">
                                            <button
                                              type="button"
                                              onClick={() => void toggleDomainPack(child.id)}
                                              className={cn(
                                                'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-l-md text-[11px] font-medium transition-all cursor-pointer border-y border-l',
                                                isChildAssigned
                                                  ? 'border-emerald-500/40 bg-emerald-500/25 text-emerald-200 font-semibold shadow-xs'
                                                  : 'border-transparent text-muted-foreground/80 hover:bg-muted/50 hover:text-foreground',
                                              )}
                                              title={`${child.name} (Inherits ${root.name}): ${child.description} (Click to toggle)`}
                                            >
                                              <span className="text-muted-foreground text-[10px]">↳</span>
                                              <span>{child.name.replace(/^.*\s*›\s*/, '')}</span>
                                              {!child.isTemplate && (
                                                <span className="text-[8px] px-1 py-0.2 rounded bg-amber-500/20 text-amber-300 font-mono">custom</span>
                                              )}
                                              {isChildAssigned ? (
                                                <span className="size-1.5 rounded-full bg-emerald-400" />
                                              ) : (
                                                <Plus size={9} className="opacity-50" />
                                              )}
                                            </button>
                                            <button
                                              type="button"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                handleOpenTagDetails(child);
                                              }}
                                              className={cn(
                                                'px-1 py-1 rounded-r-md text-muted-foreground/70 hover:text-foreground hover:bg-muted/60 transition-colors cursor-pointer border-y border-r',
                                                isChildAssigned ? 'border-emerald-500/40 bg-emerald-500/25 text-emerald-200/80 hover:text-emerald-100' : 'border-transparent',
                                              )}
                                              title={`Inspect & edit ${child.name} details`}
                                              aria-label={`Inspect & edit ${child.name} details`}
                                            >
                                              <SlidersHorizontal size={9} />
                                            </button>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  );
                                })}

                              {/* Horizontal Traits */}
                              {availableDomainPacks
                                .filter((p) => p.categoryType === 'trait')
                                .map((trait) => {
                                  const isAssigned = (domainData?.assignedDomainPackIds || selected.domainPacks || []).includes(trait.id);
                                  return (
                                    <div
                                      key={trait.id}
                                      className={cn(
                                        'inline-flex items-center rounded-lg border transition-all p-0.5 gap-0.5',
                                        isAssigned
                                          ? 'border-indigo-500/40 bg-indigo-500/15 text-indigo-300 shadow-xs'
                                          : 'border-border/60 bg-muted/30 text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                                      )}
                                    >
                                      <button
                                        type="button"
                                        onClick={() => void toggleDomainPack(trait.id)}
                                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-l-md text-xs font-medium cursor-pointer"
                                        title={`Cross-cutting Trait: ${trait.name} - ${trait.description} (Click to toggle)`}
                                      >
                                        <ShieldCheck size={11} className={isAssigned ? 'text-indigo-400' : 'text-muted-foreground'} />
                                        <span>{trait.name}</span>
                                        <span className="text-[9px] px-1 py-0.2 rounded bg-indigo-500/20 text-indigo-200 font-mono">Trait</span>
                                        {!trait.isTemplate && (
                                          <span className="text-[8px] px-1 py-0.2 rounded bg-amber-500/20 text-amber-300 font-mono">custom</span>
                                        )}
                                        {isAssigned ? (
                                          <span className="size-1.5 rounded-full bg-indigo-400" />
                                        ) : (
                                          <Plus size={10} className="opacity-50" />
                                        )}
                                      </button>
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleOpenTagDetails(trait);
                                        }}
                                        className="p-1 rounded-r-md text-muted-foreground/70 hover:text-foreground hover:bg-muted/60 transition-colors cursor-pointer"
                                        title={`Inspect & edit ${trait.name} details`}
                                        aria-label={`Inspect & edit ${trait.name} details`}
                                      >
                                        <SlidersHorizontal size={10} />
                                      </button>
                                    </div>
                                  );
                                })}
                            </div>

                            {/* Add Category Button */}
                            <Button
                              size="xs"
                              variant="ghost"
                              onClick={() => setShowCreateTagModal(true)}
                              className="h-6 px-2 text-[11px] gap-1 text-muted-foreground hover:text-foreground border border-dashed border-border/80"
                            >
                              <Plus size={11} />
                              <span>New Category / Trait</span>
                            </Button>
                          </div>

                          {/* SCOPED MICROSERVICES CONTAINER */}
                          {((domainData?.editRepos && domainData.editRepos.length > 0) ||
                            (domainData?.referenceRepos && domainData.referenceRepos.length > 0)) && (
                            <div className="flex flex-wrap items-center gap-1.5 p-2 rounded-lg bg-muted/40 border border-border/60 text-xs">
                              <span className="font-semibold text-muted-foreground flex items-center gap-1 text-[11px]">
                                <FolderGit2 size={12} className="text-primary" />
                                <span>Scoped Microservices:</span>
                              </span>
                              {domainData.editRepos?.map((repo) => (
                                <span
                                  key={repo}
                                  className="px-2 py-0.5 rounded bg-primary/10 text-primary border border-primary/20 font-mono text-[11px] flex items-center gap-1 shadow-xs"
                                  title="Active Worktree (Edit Mode)"
                                >
                                  <Edit3 size={10} />
                                  <span>{repo}</span>
                                  <span className="text-[9px] opacity-75 font-sans font-semibold">(edit)</span>
                                </span>
                              ))}
                              {domainData.referenceRepos?.map((repo) => (
                                <span
                                  key={repo}
                                  className="px-2 py-0.5 rounded bg-muted text-muted-foreground border border-border/80 font-mono text-[11px] flex items-center gap-1"
                                  title="Reference Mode (Read-only context)"
                                >
                                  <span>{repo}</span>
                                  <span className="text-[9px] opacity-75 font-sans">(ref)</span>
                                </span>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* SPEC CONTENT OR EDITOR */}
                        {editingSpec ? (
                          <div className="space-y-2 pt-1">
                            <textarea
                              value={specInput}
                              onChange={(e) => setSpecInput(e.target.value)}
                              rows={5}
                              placeholder="Enter or paste feature specifications, user stories, acceptance criteria, or implementation notes..."
                              className="w-full text-xs font-mono p-3 rounded-lg border border-border/80 bg-background/80 text-foreground focus:outline-none focus:ring-1 focus:ring-primary leading-relaxed resize-y"
                            />
                            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                              <span className="flex items-center gap-1">
                                <Sparkles size={11} className="text-amber-400" />
                                <span>Auto-detects subsystem domain tags upon saving</span>
                              </span>
                              <span>{specInput.length} chars</span>
                            </div>
                          </div>
                        ) : (
                          <div className="text-xs leading-relaxed text-foreground/90 max-h-44 overflow-y-auto pr-1">
                            {selected.description ? (
                              <ChatMarkdown content={selected.description} />
                            ) : (
                              <div className="text-muted-foreground italic py-2">
                                No specification recorded. Click "Edit Spec" to attach PO requirements or bug notes.
                              </div>
                            )}
                          </div>
                        )}

                        {/* ACTIVE SUBSYSTEM RULES & COMPLIANCE PREVIEW */}
                        {domainData?.allRules && domainData.allRules.length > 0 && (
                          <div className="mt-2 pt-2 border-t border-border/50 space-y-1.5">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                                <ShieldCheck size={12} className="text-emerald-400" />
                                <span>Active Rules & Verification ({domainData.allRules.length})</span>
                              </div>
                              <div className="flex items-center gap-1 text-[9px] text-muted-foreground">
                                <span className="px-1 py-0.2 rounded bg-purple-500/10 text-purple-300">Org Root</span>
                                <span>›</span>
                                <span className="px-1 py-0.2 rounded bg-emerald-500/10 text-emerald-300">Verticals</span>
                                <span>›</span>
                                <span className="px-1 py-0.2 rounded bg-indigo-500/10 text-indigo-300">Traits</span>
                              </div>
                            </div>
                            <div className="space-y-1 max-h-28 overflow-y-auto pr-1">
                              {domainData.allRules.slice(0, 4).map((rule, idx) => (
                                <div key={idx} className="text-[11px] text-muted-foreground/90 flex items-start gap-1.5 leading-snug">
                                  <span className="text-primary font-bold">›</span>
                                  <span className="truncate">{rule}</span>
                                </div>
                              ))}
                              {domainData.allRules.length > 4 && (
                                <div className="text-[10px] text-muted-foreground italic pl-3">
                                  +{domainData.allRules.length - 4} more domain rules active in AGENTS.md
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </Card>

                      {/* SECTION: ATTACHED SKILLS */}
                      <Card className="border-border/80 bg-card/70 backdrop-blur-md rounded-xl p-4 shadow-xs">
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-2">
                            <Puzzle size={15} className="text-primary" />
                            <h3 className="text-xs font-extrabold uppercase tracking-wider text-foreground">
                              Skills & Capabilities ({activeSkills.length})
                            </h3>
                          </div>
                          <Button
                            size="xs"
                            variant="outline"
                            onClick={() => onSelectTab(selected.branchName, 'skills')}
                            className="text-[11px] font-semibold gap-1 h-7"
                          >
                            <Puzzle size={11} />
                            <span>Configure</span>
                          </Button>
                        </div>
                        {activeSkills.length === 0 ? (
                          <p className="text-[11px] text-muted-foreground">No custom skills attached to this workspace.</p>
                        ) : (
                          <div className="flex flex-wrap gap-1.5">
                            {activeSkills.map((skill) => (
                              <span
                                key={skill.id}
                                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-mono font-medium border border-border/70 bg-card/60"
                                title={skill.description}
                              >
                                <Puzzle size={10} className="text-primary" />
                                {skill.title || skill.name}
                              </span>
                            ))}
                          </div>
                        )}
                      </Card>
                    </div>
                  </div>
                </div>
              )}
              {subTab === 'sessions' && (
                <section aria-labelledby="session-history-heading" className="space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-xl border border-border bg-card shadow-xs">
                    <div>
                      <h2 id="session-history-heading" className="text-sm font-semibold text-foreground">
                        AI Sessions & History
                      </h2>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Inspect recorded session logs, turns, and token usage, or open active conversations in the floating chat.
                      </p>
                    </div>
                    <Button
                      variant="default"
                      size="sm"
                      onClick={() => openFloatingChat(selected.branchName)}
                      className="text-xs h-8 gap-1.5 shrink-0 cursor-pointer self-start sm:self-auto"
                      title="Open floating multi-workspace chat"
                    >
                      <Bot className="size-3.5" />
                      <span>Open Floating Chat</span>
                    </Button>
                  </div>
                  <SessionHistory ws={selected} showToast={showToast} {...sessionProps} />
                </section>
              )}
              {subTab === 'changes' && <ChangesViewer ws={selected} {...changesProps} />}
              {subTab === 'knowledge' && <KnowledgeBase ws={selected} {...knowledgeProps} />}
              {subTab === 'skills' && <WorkspaceSkillsTab ws={selected} showToast={showToast} />}
            </TabsPanel>
          </Tabs>
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full animate-fade-in w-full min-w-0 bg-transparent">
      {!selected ? (
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="max-w-md w-full">
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <FolderGit2 />
                </EmptyMedia>
                <EmptyTitle>No workspace selected</EmptyTitle>
                <EmptyDescription>
                  Select a workspace from the sidebar to inspect git changes, context, or launch AI assistants.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          </div>
        </div>
      ) : (
        <div className="flex-1 min-w-0 h-full overflow-y-auto">
          <div className="mx-auto flex w-full max-w-6xl flex-col">
            {renderInspector()}
          </div>
        </div>
      )}

      {/* MODAL: CREATE NEW CATEGORY / TRAIT */}
      <Dialog open={showCreateTagModal} onOpenChange={setShowCreateTagModal}>
        <DialogPopup className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Tag size={16} className="text-primary" />
              <span>Create Enterprise Category or Trait</span>
            </DialogTitle>
            <DialogDescription>
              Define a vertical business subsystem or horizontal cross-cutting trait with architectural invariants, microservice bindings, and verification commands.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel className="space-y-3.5 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-foreground">Name</label>
                <Input
                  value={newTagName}
                  onChange={(e) => setNewTagName(e.target.value)}
                  placeholder="e.g. Order Processing"
                  size="sm"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold text-foreground">Tag ID / Slug</label>
                <Input
                  value={newTagId}
                  onChange={(e) => setNewTagId(e.target.value)}
                  placeholder="e.g. orders"
                  size="sm"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-foreground">Type</label>
                <select
                  value={newTagType}
                  onChange={(e) => setNewTagType(e.target.value as 'vertical' | 'trait')}
                  className="w-full h-7.5 px-2 text-xs rounded-md border border-border bg-background text-foreground"
                >
                  <option value="vertical">Vertical Subsystem</option>
                  <option value="trait">Horizontal Trait</option>
                </select>
              </div>
              {newTagType === 'vertical' && (
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-foreground">Parent Category (optional)</label>
                  <select
                    value={newTagParent}
                    onChange={(e) => setNewTagParent(e.target.value)}
                    className="w-full h-7.5 px-2 text-xs rounded-md border border-border bg-background text-foreground"
                  >
                    <option value="">None (Top-level vertical)</option>
                    {availableDomainPacks
                      .filter((p) => p.categoryType !== 'trait' && !p.parent)
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} (#{p.id})
                        </option>
                      ))}
                  </select>
                </div>
              )}
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-foreground">Description</label>
              <Input
                value={newTagDescription}
                onChange={(e) => setNewTagDescription(e.target.value)}
                placeholder="Brief description of scope & responsibility"
                size="sm"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-foreground">Verification Command</label>
              <Input
                value={newTagVerifyCmd}
                onChange={(e) => setNewTagVerifyCmd(e.target.value)}
                placeholder="e.g. npm test -- orders"
                size="sm"
              />
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div className="col-span-2 space-y-1">
                <label className="text-xs font-semibold text-foreground">Microservice Binding (optional)</label>
                <Input
                  value={newTagMicroserviceName}
                  onChange={(e) => setNewTagMicroserviceName(e.target.value)}
                  placeholder="e.g. orders-service"
                  size="sm"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold text-foreground">Target Mode</label>
                <select
                  value={newTagMicroserviceTarget}
                  onChange={(e) => setNewTagMicroserviceTarget(e.target.value as 'edit' | 'reference')}
                  className="w-full h-7.5 px-2 text-xs rounded-md border border-border bg-background text-foreground"
                >
                  <option value="edit">Edit (Worktree)</option>
                  <option value="reference">Reference Only</option>
                </select>
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-foreground">Architectural Invariants & Rules (one per line)</label>
              <textarea
                rows={3}
                value={newTagRules}
                onChange={(e) => setNewTagRules(e.target.value)}
                placeholder="e.g. Order amounts must always include currency code and tax breakdown."
                className="w-full text-xs font-mono p-2 rounded-md border border-border bg-background text-foreground resize-y"
              />
            </div>
          </DialogPanel>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setShowCreateTagModal(false)}>
              Cancel
            </Button>
            <Button
              variant="default"
              size="sm"
              disabled={!newTagId.trim() || !newTagName.trim() || savingNewTag}
              onClick={() => void handleCreateDomainPack()}
            >
              {savingNewTag ? <Spinner size="sm" /> : <Check size={12} />}
              <span>Create Category</span>
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>

      {/* MODAL: INSPECT & EDIT EXISTING CATEGORY / TRAIT TAG */}
      <Dialog open={!!inspectingTag} onOpenChange={(open) => !open && setInspectingTag(null)}>
        <DialogPopup className="max-w-xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <div className="flex items-center justify-between pr-6">
              <DialogTitle className="flex items-center gap-2">
                {inspectTagType === 'trait' ? (
                  <ShieldCheck size={18} className="text-indigo-400" />
                ) : (
                  <Tag size={18} className="text-primary" />
                )}
                <span>Inspect & Edit {inspectTagType === 'trait' ? 'Trait' : 'Category'}</span>
              </DialogTitle>
              {inspectingTag && (
                <span
                  className={cn(
                    'text-[10px] px-2 py-0.5 rounded-full font-mono font-semibold border',
                    inspectingTag.isTemplate
                      ? 'border-blue-500/30 bg-blue-500/10 text-blue-300'
                      : 'border-amber-500/30 bg-amber-500/10 text-amber-300',
                  )}
                >
                  {inspectingTag.isTemplate ? 'Built-in Template' : 'Custom / Overridden'}
                </span>
              )}
            </div>
            <DialogDescription>
              View and configure full details: architectural invariants, verification command, scoped microservices, and attached agent skills.
            </DialogDescription>
          </DialogHeader>

          <DialogPanel className="space-y-4 py-2 overflow-y-auto flex-1 pr-1">
            {/* Name & ID Slug */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-foreground">Name</label>
                <Input
                  value={inspectTagName}
                  onChange={(e) => setInspectTagName(e.target.value)}
                  placeholder="e.g. Order Processing"
                  size="sm"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold text-foreground">Tag ID / Slug</label>
                <Input
                  value={inspectingTag?.id || ''}
                  disabled
                  size="sm"
                  className="bg-muted/50 font-mono text-xs cursor-not-allowed"
                />
              </div>
            </div>

            {/* Type & Parent */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-foreground">Category Type</label>
                <select
                  value={inspectTagType}
                  onChange={(e) => setInspectTagType(e.target.value as 'vertical' | 'trait')}
                  className="w-full h-7.5 px-2 text-xs rounded-md border border-border bg-background text-foreground"
                >
                  <option value="vertical">Vertical Subsystem</option>
                  <option value="trait">Horizontal Trait</option>
                </select>
              </div>
              {inspectTagType === 'vertical' && (
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-foreground">Parent Category</label>
                  <select
                    value={inspectTagParent}
                    onChange={(e) => setInspectTagParent(e.target.value)}
                    className="w-full h-7.5 px-2 text-xs rounded-md border border-border bg-background text-foreground"
                  >
                    <option value="">None (Top-level vertical)</option>
                    {availableDomainPacks
                      .filter((p) => p.categoryType !== 'trait' && !p.parent && p.id !== inspectingTag?.id)
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} (#{p.id})
                        </option>
                      ))}
                  </select>
                </div>
              )}
            </div>

            {/* Description */}
            <div className="space-y-1">
              <label className="text-xs font-semibold text-foreground">Description</label>
              <Input
                value={inspectTagDescription}
                onChange={(e) => setInspectTagDescription(e.target.value)}
                placeholder="Brief description of scope & responsibility"
                size="sm"
              />
            </div>

            {/* Architectural Invariants & Rules */}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-foreground">Architectural Invariants & Rules</label>
                <span className="text-[10px] text-muted-foreground">Injected into workspace AGENTS.md</span>
              </div>
              <textarea
                rows={4}
                value={inspectTagRules}
                onChange={(e) => setInspectTagRules(e.target.value)}
                placeholder="e.g. Orders must be signed before publishing to event bus.&#10;Amounts must include ISO-4217 currency code."
                className="w-full text-xs font-mono p-2 rounded-md border border-border bg-background text-foreground resize-y leading-relaxed"
              />
            </div>

            {/* Verification Command */}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-foreground">Mechanical Verification Command</label>
                <span className="text-[10px] text-muted-foreground">Runs during verification gates</span>
              </div>
              <Input
                value={inspectTagVerifyCmd}
                onChange={(e) => setInspectTagVerifyCmd(e.target.value)}
                placeholder="e.g. npm test -- orders"
                size="sm"
                className="font-mono text-xs"
              />
            </div>

            {/* Scoped Microservices */}
            <div className="space-y-2 p-3 rounded-lg bg-muted/20 border border-border/60">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                  <FolderGit2 size={13} className="text-primary" />
                  <span>Scoped Microservices ({inspectTagMicroservices.length})</span>
                </label>
                <span className="text-[10px] text-muted-foreground">Worktrees created when tag attached</span>
              </div>

              {inspectTagMicroservices.length > 0 && (
                <div className="space-y-1.5 max-h-32 overflow-y-auto pr-1">
                  {inspectTagMicroservices.map((ms, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between px-2 py-1 rounded bg-card border border-border/60 text-xs"
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-medium text-foreground">{ms.name}</span>
                        <span
                          className={cn(
                            'text-[9px] px-1.5 py-0.2 rounded font-semibold',
                            ms.target === 'edit'
                              ? 'bg-primary/15 text-primary border border-primary/20'
                              : 'bg-muted text-muted-foreground',
                          )}
                        >
                          {ms.target === 'edit' ? 'Edit (Worktree)' : 'Reference'}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          setInspectTagMicroservices((prev) => prev.filter((_, i) => i !== idx))
                        }
                        className="p-1 text-muted-foreground hover:text-destructive transition-colors cursor-pointer"
                        title="Remove microservice binding"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex items-center gap-2 pt-1">
                <Input
                  value={inspectNewMsName}
                  onChange={(e) => setInspectNewMsName(e.target.value)}
                  placeholder="Microservice repo name (e.g. orders-service)"
                  size="sm"
                  className="flex-1 text-xs font-mono"
                />
                <select
                  value={inspectNewMsTarget}
                  onChange={(e) => setInspectNewMsTarget(e.target.value as 'edit' | 'reference')}
                  className="h-7.5 px-2 text-xs rounded-md border border-border bg-background text-foreground"
                >
                  <option value="edit">Edit (Worktree)</option>
                  <option value="reference">Reference Only</option>
                </select>
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  disabled={!inspectNewMsName.trim()}
                  onClick={() => {
                    if (!inspectNewMsName.trim()) return;
                    setInspectTagMicroservices((prev) => [
                      ...prev,
                      { name: inspectNewMsName.trim(), target: inspectNewMsTarget },
                    ]);
                    setInspectNewMsName('');
                  }}
                  className="h-7.5 text-xs shrink-0"
                >
                  <Plus size={11} className="mr-1" />
                  Add
                </Button>
              </div>
            </div>

            {/* Attached Skills */}
            <div className="space-y-2 p-3 rounded-lg bg-muted/20 border border-border/60">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                  <Sparkles size={13} className="text-primary" />
                  <span>Attached Skills ({inspectTagSkills.length})</span>
                </label>
                <span className="text-[10px] text-muted-foreground">Auto-activated when tag is selected</span>
              </div>

              <div className="flex flex-wrap items-center gap-1.5 min-h-7">
                {inspectTagSkills.length === 0 ? (
                  <span className="text-xs text-muted-foreground italic">No attached skills.</span>
                ) : (
                  inspectTagSkills.map((skId) => {
                    const skillObj = allSkills.find((s) => s.id === skId);
                    return (
                      <span
                        key={skId}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] bg-primary/10 text-primary border border-primary/20 font-medium"
                      >
                        <span>{skillObj?.title || skillObj?.name || skId}</span>
                        <button
                          type="button"
                          onClick={() => setInspectTagSkills((prev) => prev.filter((id) => id !== skId))}
                          className="hover:text-destructive cursor-pointer ml-0.5"
                        >
                          <X size={11} />
                        </button>
                      </span>
                    );
                  })
                )}
              </div>

              <div className="flex items-center gap-2 pt-1">
                <select
                  value={inspectNewSkill}
                  onChange={(e) => setInspectNewSkill(e.target.value)}
                  className="flex-1 h-7.5 px-2 text-xs rounded-md border border-border bg-background text-foreground"
                >
                  <option value="">Select a skill to attach...</option>
                  {allSkills
                    .filter((s) => !inspectTagSkills.includes(s.id))
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.title || s.name} ({s.id})
                      </option>
                    ))}
                </select>
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  disabled={!inspectNewSkill}
                  onClick={() => {
                    if (!inspectNewSkill) return;
                    setInspectTagSkills((prev) => [...prev, inspectNewSkill]);
                    setInspectNewSkill('');
                  }}
                  className="h-7.5 text-xs shrink-0"
                >
                  <Plus size={11} className="mr-1" />
                  Attach Skill
                </Button>
              </div>
            </div>

            {/* Tags / Keywords */}
            <div className="space-y-1">
              <label className="text-xs font-semibold text-foreground">Discovery Tags (comma-separated)</label>
              <Input
                value={inspectTagTags}
                onChange={(e) => setInspectTagTags(e.target.value)}
                placeholder="e.g. economy, finance, invoicing"
                size="sm"
                className="font-mono text-xs"
              />
            </div>
          </DialogPanel>

          <DialogFooter className="flex items-center justify-between sm:justify-between w-full pt-3 border-t">
            <div>
              {!inspectingTag?.isTemplate && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void handleDeleteOrResetTag()}
                  disabled={deletingTagDetails || savingTagDetails}
                  className="text-destructive hover:bg-destructive/10 border-destructive/30 text-xs gap-1.5"
                >
                  {deletingTagDetails ? (
                    <Spinner size="sm" />
                  ) : (
                    <RotateCcw size={12} />
                  )}
                  <span>
                    {['economy', 'transport', 'tax', 'payroll', 'fintech', 'security', 'audit', 'performance', 'testing', 'accessibility', 'offline'].includes(inspectingTag?.id || '')
                      ? 'Reset to Defaults'
                      : 'Delete Tag'}
                  </span>
                </Button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setInspectingTag(null)}>
                Cancel
              </Button>
              <Button
                variant="default"
                size="sm"
                disabled={!inspectTagName.trim() || savingTagDetails}
                onClick={() => void handleSaveTagDetails()}
                className="gap-1.5"
              >
                {savingTagDetails ? <Spinner size="sm" /> : <Check size={12} />}
                <span>Save Changes</span>
              </Button>
            </div>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </div>
  );
}
