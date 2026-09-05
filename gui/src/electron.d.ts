declare global {
  interface NexusFlowDesktopUpdateState {
    supported: boolean;
    status: 'unsupported' | 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error';
    currentVersion: string;
    version?: string | null;
    releaseNotes?: string | null;
    progress?: number;
    error?: string | null;
  }

  interface NexusFlowDesktopBridge {
    getServerPort: () => Promise<number>;
    updates?: {
      getStatus: () => Promise<NexusFlowDesktopUpdateState>;
      check: () => Promise<NexusFlowDesktopUpdateState>;
      download: () => Promise<NexusFlowDesktopUpdateState>;
      restart: () => Promise<NexusFlowDesktopUpdateState>;
      onEvent: (listener: (state: NexusFlowDesktopUpdateState) => void) => () => void;
    };
  }

  interface Window {
    nexusBridge?: NexusFlowDesktopBridge;
  }
}

export {};
