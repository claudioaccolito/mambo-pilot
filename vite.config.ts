import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from 'vite'

// base relativa: funziona sia su un dominio che in una sottocartella (es. GitHub Pages /mambo-pwa/)
export default defineConfig({
  base: './',
  plugins: [svelte()],
  server: { host: true },
})
