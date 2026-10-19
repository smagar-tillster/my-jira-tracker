import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
    plugins: [react()],
    server: {
        port: 3051,
        strictPort: false,
        open: true,
        proxy: {
            '/api': {
                target: process.env.VITE_BACKEND_URL || 'http://localhost:3050',
                changeOrigin: true,
            },
        },
    },
    build: {
        outDir: 'dist',
        sourcemap: false,
    },
});
