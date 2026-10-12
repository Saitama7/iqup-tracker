/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
  /** Set by vite.config.ts from `CF_PAGES_COMMIT_SHA`; empty outside Cloudflare Pages. */
  readonly VITE_BUILD_SHA: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
