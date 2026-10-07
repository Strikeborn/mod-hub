/// <reference types="vite/client" />

import type { IpcApi, HubSettings } from '../shared/types';

declare global {
  interface Window {
    modHub: IpcApi;
    modHubAuth: {
      validateNexusKey: (apiKey: string) => Promise<{ ok: boolean; message: string }>;
      openSteamLogin: () => Promise<{ ok: boolean; message: string }>;
      openNexusLogin: () => Promise<{ ok: boolean; message: string }>;
    };
  }
}

declare namespace React {
  namespace JSX {
    interface IntrinsicElements {
      webview: React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & { src?: string; allowpopups?: string },
        HTMLElement
      >;
    }
  }
}

export {};
