import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// En GitHub Pages el sitio se publica en el subdirectorio del repositorio.
const base = process.env.GITHUB_ACTIONS === 'true'
  ? '/github-qy7atxn4/'
  : '/'

export default defineConfig({
  base,
  plugins: [react()],
})
