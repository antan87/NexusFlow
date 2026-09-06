import { ArrowRight, Settings as SettingsIcon } from 'lucide-react';
import { Button } from '../../components/ui/button.js';
import { Input } from '../../components/ui/input.js';
import { Select, SelectTrigger, SelectValue, SelectPopup, SelectItem } from '../../components/ui/select.js';
import type { ContextSpaceConfig, StorageAdapterMeta } from '../../types.js';
import { BRAND_NAME, OVERVIEW_FILE } from '../../brand.js';
interface OnboardingScreenProps {
  config: ContextSpaceConfig;
  setConfig: (config: ContextSpaceConfig) => void;
  defaultPaths: { devDir: string; workspacesDir: string } | null;
  adapters: StorageAdapterMeta[];
  saveAppConfig: (config: ContextSpaceConfig) => void | Promise<void>;
}

export function OnboardingScreen({
  config,
  setConfig,
  defaultPaths,
  adapters,
  saveAppConfig,
}: OnboardingScreenProps) {
  const isFormValid = config.devDir.trim() !== '' && config.workspacesDir.trim() !== '';

  return (
    <div className="flex min-h-screen bg-background text-foreground font-sans items-center justify-center p-6">
      {/* Onboarding Box */}
      <div className="max-w-6xl w-full bg-card border border-border rounded-xl p-10 shadow-sm grid grid-cols-1 lg:grid-cols-12 gap-12">
        
        {/* Left Column: Onboarding Guide & Concepts */}
        <div className="lg:col-span-7 flex flex-col justify-between">
          <div>
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary/10 text-primary border border-primary/20 text-xs font-semibold uppercase tracking-wider mb-5">
              Onboarding Guide
            </div>
            <h1 className="text-3xl font-bold tracking-tight text-foreground mb-2">
              Welcome to {BRAND_NAME}
            </h1>
            <p className="text-sm text-muted-foreground mb-8 max-w-xl leading-relaxed">
              {BRAND_NAME} orchestrates multi-repository developer environments. It combines isolated Git worktrees, automatic code analyzer sweeps, and background process running into a single dashboard.
            </p>

            {/* Onboarding Steps */}
            <div className="space-y-6">
              <div className="flex gap-4 group">
                <div className="w-8 h-8 rounded-full bg-primary/10 border border-primary/20 text-primary flex items-center justify-center font-bold text-sm shrink-0 group-hover:bg-primary/20 transition-colors">
                  1
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-foreground transition-colors">Configure Development Folders</h3>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                    Specify your local code path and target workspaces path. For the first setup, these paths start empty so you can explicitly configure them.
                  </p>
                </div>
              </div>

              <div className="flex gap-4 group">
                <div className="w-8 h-8 rounded-full bg-primary/10 border border-primary/20 text-primary flex items-center justify-center font-bold text-sm shrink-0 group-hover:bg-primary/20 transition-colors">
                  2
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-foreground transition-colors">Build Isolated Branch Workspaces</h3>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                    Choose repositories and input your feature branch. {BRAND_NAME} runs <code>git worktree</code> to checkout dependencies under a unified folder structure, leaving your primary repository directories clean.
                  </p>
                </div>
              </div>

              <div className="flex gap-4 group">
                <div className="w-8 h-8 rounded-full bg-primary/10 border border-primary/20 text-primary flex items-center justify-center font-bold text-sm shrink-0 group-hover:bg-primary/20 transition-colors">
                  3
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-foreground transition-colors">Align AI Coding Contexts</h3>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                    {BRAND_NAME} automatically generates configuration files (<code>CLAUDE.md</code>, <code>.cursorrules</code>, <code>AGENTS.md</code>) that instruct the AI assistant to analyze project inter-dependencies, document its assumptions in <code>{OVERVIEW_FILE}</code>, and highlight clarifying questions.
                  </p>
                </div>
              </div>

              <div className="flex gap-4 group">
                <div className="w-8 h-8 rounded-full bg-primary/10 border border-primary/20 text-primary flex items-center justify-center font-bold text-sm shrink-0 group-hover:bg-primary/20 transition-colors">
                  4
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-foreground transition-colors">Orchestrate Background Services</h3>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                    Run APIs, database scripts, and frontend watch tasks concurrently from the web portal. Monitor real-time logs inside a unified terminal pane.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Value Statement */}
          <div className="mt-8 pt-6 border-t border-border">
            <p className="text-sm text-muted-foreground">
              {BRAND_NAME} offers native worktrees and local AI orchestration without the overhead of containers or virtual machines.
            </p>
          </div>
        </div>

        {/* Right Column: Configuration Form */}
        <div className="lg:col-span-5 flex flex-col justify-center">
          <div className="bg-muted border border-border rounded-xl p-8 shadow-sm">
            <h2 className="text-xl font-semibold text-foreground mb-1 flex items-center gap-2">
              <SettingsIcon className="text-primary" size={20} /> Initialize Config
            </h2>
            <p className="text-sm text-muted-foreground mb-6">
              Define the directories on your machine. The fields are empty so you can provide your paths.
            </p>

            {/* Form Input fields */}
            <div className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">Development Directory</label>
                <Input
                  type="text"
                  placeholder="e.g. C:\Users\username\dev"
                  value={config.devDir}
                  onChange={(e) => setConfig({ ...config, devDir: e.target.value })}
                />
                {defaultPaths && (
                  <div className="text-xs text-muted-foreground mt-1.5 flex justify-between items-center">
                    <span>Suggested: <code className="text-primary">{defaultPaths.devDir}</code></span>
                  </div>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-2">Workspaces Directory</label>
                <Input
                  type="text"
                  placeholder="e.g. C:\Users\username\dev\workspaces"
                  value={config.workspacesDir}
                  onChange={(e) => setConfig({ ...config, workspacesDir: e.target.value })}
                />
                {defaultPaths && (
                  <div className="text-xs text-muted-foreground mt-1.5 flex justify-between items-center">
                    <span>Suggested: <code className="text-primary">{defaultPaths.workspacesDir}</code></span>
                  </div>
                )}
              </div>

              <div className="pt-2">
                <label htmlFor="onboardingStorageProvider" className="text-sm font-medium text-foreground block mb-2">
                  Storage Provider
                </label>
                <Select
                  value={config.storageProvider || 'local'}
                  onValueChange={(val) => {
                    if (!val) return;
                    const newConf = { ...config, storageProvider: val };
                    const selectedAdapter = adapters.find(a => a.name === val);
                    if (selectedAdapter?.configFields?.length) {
                      if (!newConf.adapterConfig) newConf.adapterConfig = {};
                      if (!newConf.adapterConfig[val]) newConf.adapterConfig[val] = {};
                      selectedAdapter.configFields.forEach(f => {
                        if (newConf.adapterConfig![val][f.key] === undefined && f.default !== undefined) {
                          newConf.adapterConfig![val][f.key] = f.default;
                        }
                      });
                    }
                    setConfig(newConf);
                  }}
                >
                  <SelectTrigger id="onboardingStorageProvider">
                    <SelectValue placeholder="Select a provider" />
                  </SelectTrigger>
                  <SelectPopup>
                    {adapters.length > 0 ? (
                      adapters.map((a) => (
                        <SelectItem key={a.name} value={a.name}>
                          {a.displayName}
                        </SelectItem>
                      ))
                    ) : (
                      <SelectItem value="local">Local Workspace (Folders)</SelectItem>
                    )}
                  </SelectPopup>
                </Select>
                <span className="text-xs text-muted-foreground mt-1 block leading-normal">
                  {adapters.find(a => a.name === (config.storageProvider || 'local'))?.description ||
                    'Where the generated context files are written. They must sit at the workspace root for an assistant to load them.'}
                </span>
              </div>

              {/* Form Buttons */}
              <div className="flex gap-2 pt-2">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => {
                    if (defaultPaths) {
                      setConfig({
                        ...config,
                        devDir: defaultPaths.devDir,
                        workspacesDir: defaultPaths.workspacesDir,
                      });
                    }
                  }}
                >
                  Suggest Defaults
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setConfig({
                      ...config,
                      devDir: '',
                      workspacesDir: '',
                    });
                  }}
                >
                  Clear
                </Button>
              </div>

              {/* Save Button */}
              <div className="pt-4">
                <Button
                  className="w-full gap-2"
                  disabled={!isFormValid}
                  onClick={() => saveAppConfig(config)}
                >
                  Save & Get Started <ArrowRight size={16} />
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
