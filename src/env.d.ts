/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Empty when sync has not been configured; the app runs local-only then. */
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_ANON_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
