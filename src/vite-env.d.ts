/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Cloudflare Worker for "Connect Splitwise" (splitwise-worker/). Public URL, not a secret. */
  readonly VITE_SPLITWISE_WORKER_URL?: string;
}
