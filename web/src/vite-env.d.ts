/// <reference types="vite/client" />
interface ImportMetaEnv {
  /** 'dummy' reads public/data-dummy/; anything else reads public/data/ (docs/dummy.md). */
  readonly VITE_DATA?: 'dummy' | 'real'
}
