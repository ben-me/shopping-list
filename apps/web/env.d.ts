/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the hono API; empty means same-origin. */
  readonly VITE_API_BASE_URL?: string;
}
