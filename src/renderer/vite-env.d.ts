/// <reference types="vite/client" />

import type { RalphApi } from "@shared/types";

declare global {
  interface Window {
    ralphApi: RalphApi;
  }
}

export {};
