declare global {
  interface ContextSpaceDesktopUpdateState {
    supported: boolean;
    status: 'unsupported' | 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error';
    currentVersion: string;
    version?: string | null;
    releaseNotes?: string | null;
    progress?: number;
    error?: string | null;
  }
  type NexusFlowDesktopUpdateState = ContextSpaceDesktopUpdateState;

  interface ContextSpaceDesktopBridge {
    getServerPort: () => Promise<number>;
    updates?: {
      getStatus: () => Promise<ContextSpaceDesktopUpdateState>;
      check: () => Promise<ContextSpaceDesktopUpdateState>;
      download: () => Promise<ContextSpaceDesktopUpdateState>;
      restart: () => Promise<ContextSpaceDesktopUpdateState>;
      onEvent: (listener: (state: ContextSpaceDesktopUpdateState) => void) => () => void;
    };
  }
  type NexusFlowDesktopBridge = ContextSpaceDesktopBridge;

  interface Window {
    contextspaceBridge?: ContextSpaceDesktopBridge;
    nexusBridge?: ContextSpaceDesktopBridge;
  }
}

export {};
