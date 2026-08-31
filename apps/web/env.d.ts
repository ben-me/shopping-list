/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the hono API. Unset (`""`) means same-origin; set it to the
   *  Worker origin when web and api run on different domains (e.g. in dev). */
  readonly VITE_API_BASE_URL?: string;
}
