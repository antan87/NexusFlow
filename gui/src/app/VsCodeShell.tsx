import type { RefObject } from 'react';
import { Play, X } from 'lucide-react';
import type { Feature, NexusFlowConfig, RunningService, ServiceConfig } from '../types.js';

interface VsCodeShellProps {
  activeWsId: string | null;
  setActiveWsId: (workspaceId: string | null) => void;
  selectedLogService: string | null;
  setSelectedLogService: (serviceName: string | null) => void;
  setServiceLogs: (logs: string) => void;
  appVersion: string;
  workspaces: Feature[];
  fetchWorkspaceServices: (wsId: string, silent?: boolean) => Promise<void>;
  config: NexusFlowConfig | null;
  services: ServiceConfig[];
  runningServices: RunningService[];
  handleStartServices: (wsId: string) => Promise<void>;
  handleStopServices: (wsId: string) => Promise<void>;
  executeTerminal: (command: string) => void;
  fetchLogs: (wsId: string, serviceName: string) => Promise<void>;
  serviceLogs: string;
  logsEndRef: RefObject<HTMLDivElement | null>;
}

export function VsCodeShell({
  activeWsId,
  setActiveWsId,
  selectedLogService,
  setSelectedLogService,
  setServiceLogs,
  appVersion,
  workspaces,
  fetchWorkspaceServices,
  config,
  services,
  runningServices,
  handleStartServices,
  handleStopServices,
  executeTerminal,
  fetchLogs,
  serviceLogs,
  logsEndRef,
}: VsCodeShellProps) {
  return (
    <div className="flex flex-col h-screen w-full bg-[#060813] text-[#d1d5db] font-mono text-[11px] overflow-hidden select-none border-t border-gray-800">
      {/* Terminal Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-surface border-b border-gray-800 shrink-0 text-[10px]">
        <div className="flex items-center gap-2">
          <span className="font-bold text-indigo-400">NEXUSFLOW_SHELL</span>
          <span className="text-gray-700">|</span>
          <span className="text-gray-300">ws: {activeWsId || 'none'}</span>
        </div>
        <div className="flex items-center gap-2">
          {activeWsId && (
            <button
              onClick={() => {
                setActiveWsId(null);
                setSelectedLogService(null);
                setServiceLogs('');
              }}
              className="text-indigo-400 hover:text-indigo-350 hover:underline transition-colors cursor-pointer bg-transparent border-none p-0 outline-none"
            >
              [Change WS]
            </button>
          )}
          {appVersion && <span className="text-[10px] text-gray-500">v{appVersion}</span>}
        </div>
      </div>

      {!activeWsId ? (
        /* CLI Workspace Selection Menu */
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center overflow-y-auto">
          <div className="text-indigo-400 font-bold mb-4 text-[12px] uppercase">
            === Select Active Workspace ===
          </div>
          <div className="flex flex-col gap-2 w-full max-w-xs">
            {workspaces.map((ws) => (
              <button
                key={ws.branchName}
                onClick={() => {
                  setActiveWsId(ws.branchName);
                  fetchWorkspaceServices(ws.branchName);
                }}
                className="w-full text-left p-2.5 bg-gray-950 border border-gray-800 hover:border-indigo-500 rounded hover:bg-indigo-500/5 text-gray-300 hover:text-white transition-all text-[11px] cursor-pointer"
              >
                &gt; {ws.branchName}
              </button>
            ))}
            {workspaces.length === 0 && (
              <div className="text-gray-550 italic">No workspaces found. Initialize one via the CLI.</div>
            )}
          </div>
        </div>
      ) : (
        /* Active Workspace Panel */
        <div className="flex-1 flex flex-col min-h-0">
          {/* Top Config / Control Panel */}
          <div className="p-3 border-b border-gray-800 shrink-0 bg-gray-950/30">
            {/* Service Control Buttons */}
            <div className="flex gap-2 mb-3">
              <button
                onClick={() => handleStartServices(activeWsId)}
                className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded border border-emerald-500/20 bg-emerald-500/5 hover:bg-emerald-500/10 text-emerald-400 font-bold transition-all cursor-pointer text-[10px]"
              >
                <Play size={10} /> [START SERVICES]
              </button>
              <button
                onClick={() => handleStopServices(activeWsId)}
                className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded border border-rose-500/20 bg-rose-500/5 hover:bg-rose-500/10 text-rose-400 font-bold transition-all cursor-pointer text-[10px]"
              >
                <X size={10} /> [STOP SERVICES]
              </button>
            </div>

            {/* Service List */}
            <div className="mb-3">
              <div className="text-[10px] text-gray-400 uppercase font-bold tracking-wider mb-1 px-1">
                Background Services ({runningServices.filter(rs => rs.pid > 0).length}/{services.length})
              </div>
              {services.length === 0 ? (
                <div className="text-gray-600 italic px-1 text-[10px]">No services detected in workspace.</div>
              ) : (
                <div className="flex flex-col gap-1 max-h-[120px] overflow-y-auto pr-1">
                  {services.map((service) => {
                    const isRunning = runningServices.some((rs) => rs.name === service.name && rs.pid > 0);
                    const isSelected = selectedLogService === service.name;
                    return (
                      <div
                        key={service.name}
                        onClick={() => setSelectedLogService(service.name)}
                        className={`flex items-center justify-between p-1.5 border rounded cursor-pointer transition-all ${
                          isSelected
                            ? 'bg-indigo-950/40 border-indigo-500/50 text-white'
                            : 'bg-gray-950/20 border-gray-800 hover:border-gray-700 text-gray-300'
                        }`}
                      >
                        <div className="flex items-center gap-2 truncate">
                          <span className={`h-1.5 w-1.5 rounded-full ${isRunning ? 'bg-emerald-400 animate-pulse' : 'bg-rose-500'}`}></span>
                          <span className="font-bold truncate">{service.name}</span>
                        </div>
                        <span className="text-[10px] font-mono shrink-0">
                          {isRunning ? (
                            <span className="text-emerald-400 bg-emerald-500/10 px-1 py-0.2 rounded border border-emerald-500/20 text-[8px] font-bold uppercase">on</span>
                          ) : (
                            <span className="text-gray-500 bg-gray-900 px-1 py-0.2 rounded border border-gray-800 text-[8px] font-bold uppercase">off</span>
                          )}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* MCP Status Check */}
            <div className="mb-3 border-t border-gray-800 pt-2.5">
              <div className="text-[10px] text-gray-400 font-bold uppercase mb-1 px-1">
                Active Local MCP Tools
              </div>
              <div className="flex flex-col gap-1 px-1 text-[10px] text-gray-450 font-mono">
                <div className="flex justify-between">
                  <span>• search_workspace</span>
                  <span className="text-indigo-400 font-bold">READY</span>
                </div>
                <div className="flex justify-between">
                  <span>• get_service_logs</span>
                  <span className="text-indigo-400 font-bold">READY</span>
                </div>
                <div className="flex justify-between">
                  <span>• delegate_to_local_agent</span>
                  <span className={config?.localLlm?.enabled ? "text-indigo-400 font-bold" : "text-gray-600 font-bold"}>
                    {config?.localLlm?.enabled ? 'READY' : 'DISABLED'}
                  </span>
                </div>
              </div>
            </div>

            {/* Interactive CLI Buttons */}
            <div className="border-t border-gray-800 pt-2.5">
              <div className="text-[10px] text-gray-400 font-bold uppercase mb-1.5 px-1">
                Terminal Commands (Click to Run)
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  onClick={() => executeTerminal('nexusflow sync')}
                  className="px-2 py-1.5 text-left border border-gray-850 hover:border-indigo-500 bg-gray-950/40 rounded text-gray-300 hover:text-white hover:bg-indigo-950/20 transition-all font-mono text-[9px] cursor-pointer"
                >
                  $ nexusflow sync
                </button>
                <button
                  onClick={() => executeTerminal('nexusflow diff')}
                  className="px-2 py-1.5 text-left border border-gray-850 hover:border-indigo-500 bg-gray-950/40 rounded text-gray-300 hover:text-white hover:bg-indigo-950/20 transition-all font-mono text-[9px] cursor-pointer"
                >
                  $ nexusflow diff
                </button>
                <button
                  onClick={() => executeTerminal('nexusflow handoff')}
                  className="px-2 py-1.5 text-left border border-gray-850 hover:border-indigo-500 bg-gray-950/40 rounded text-gray-300 hover:text-white hover:bg-indigo-950/20 transition-all font-mono text-[9px] cursor-pointer"
                >
                  $ nexusflow handoff
                </button>
                <button
                  onClick={() => executeTerminal('nexusflow status')}
                  className="px-2 py-1.5 text-left border border-gray-850 hover:border-indigo-500 bg-gray-950/40 rounded text-gray-300 hover:text-white hover:bg-indigo-950/20 transition-all font-mono text-[9px] cursor-pointer"
                >
                  $ nexusflow status
                </button>
              </div>
            </div>
          </div>

          {/* Bottom Log Pane */}
          <div className="flex-1 flex flex-col min-h-0 bg-[#04060d]">
            <div className="flex items-center justify-between px-3 py-1.5 bg-[#090d1a] border-b border-gray-800/80 shrink-0 text-[9px] text-gray-400 uppercase tracking-wider font-bold">
              <div className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-indigo-500 animate-pulse"></span>
                <span>log_stream: {selectedLogService || 'none'}</span>
              </div>
              <button
                onClick={() => {
                  if (activeWsId && selectedLogService) {
                    fetchLogs(activeWsId, selectedLogService);
                  }
                }}
                className="text-gray-500 hover:text-white font-mono hover:underline cursor-pointer bg-transparent border-none p-0 outline-none"
              >
                [refresh]
              </button>
            </div>
            <div className="flex-1 p-3 overflow-y-auto font-mono text-[10px] leading-relaxed whitespace-pre-wrap select-text selection:bg-indigo-500/30 text-gray-300">
              {serviceLogs.trim() ? (
                serviceLogs
              ) : (
                <span className="text-gray-600 italic font-mono">(no logs recorded yet)</span>
              )}
              <div ref={logsEndRef} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
