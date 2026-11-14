import { defineConfig } from 'vite'

// Relative base so the build works under a GitHub Pages project path.
export default defineConfig({
  base: './',
  server: { fs: { allow: ['..'] } }, // config/ and contracts/ live one level up
})
