export {};

declare global {
  interface Window {
    llamaApi: {
      getConfig: () => Promise<any>;
      saveConfig: (config: any) => Promise<any>;
      status: () => Promise<{ services: any[]; gpu: any | null }>;
      start: (id: string) => Promise<any>;
      stop: (id: string) => Promise<any>;
      restart: (id: string) => Promise<any>;
      getLog: (id: string, tail?: number) => Promise<string>;
      clearLog: (id: string) => Promise<boolean>;
      scanModels: () => Promise<any[]>;
      startTrial: (model: string, mmproj?: string) => Promise<any>;
      reloadConfig: () => Promise<{ restarted: string[] }>;
      downloadModel: (req: { name?: string; url?: string }) => Promise<{ ok: boolean; path?: string; error?: string }>;
      windowControl: (action: 'hide' | 'minimize' | 'close') => Promise<any>;
      quit: () => Promise<any>;
      onServicesChanged: (cb: (payload: { services: any[]; gpu: any | null }) => void) => () => void;
      onConfigChanged: (cb: () => void) => () => void;
    };
  }
}