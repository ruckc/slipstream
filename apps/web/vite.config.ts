import { sveltekit } from '@sveltejs/kit/vite'
import { defineConfig } from 'vite'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const version = readFileSync(resolve(__dirname, '../../VERSION'), 'utf-8').trim()

export default defineConfig({
  plugins: [sveltekit()],
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
})
