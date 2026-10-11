/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Empty when sync has not been configured; the app runs local-only then. */
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_ANON_KEY?: string
  /**
   * Single-user auto sign-in. Both empty leaves the magic link as the only
   * way in. See the comment on `ensureSignedIn` before setting them.
   */
  readonly VITE_BP_EMAIL?: string
  readonly VITE_BP_PASSWORD?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
