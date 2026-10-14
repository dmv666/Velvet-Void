import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv, type Plugin } from 'vite';

/**
 * CSP estricta inyectada SOLO en el build (el servidor de desarrollo de Vite necesita scripts
 * inline para HMR). En producción, además, el CDN la envía como cabecera (public/_headers):
 * la meta no admite frame-ancestors.
 */
function cspPlugin(apiOrigin: string): Plugin {
  const connect = ["'self'", apiOrigin].filter(Boolean).join(' ');
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "media-src 'self' blob:",
    `connect-src ${connect}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
  ].join('; ');
  return {
    name: 'velvet-csp',
    apply: 'build',
    transformIndexHtml: (html) =>
      html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${csp}" />`),
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const apiBase = env.VITE_API_BASE ?? '';
  return {
    plugins: [react(), cspPlugin(apiBase ? new URL(apiBase).origin : '')],
    server: {
      port: 5173,
      strictPort: true,
      // Mismo origen en desarrollo: el navegador habla con Vite y Vite reenvía /api al servidor.
      proxy: { '/api': { target: 'http://127.0.0.1:3000', changeOrigin: false } },
    },
    build: {
      target: 'es2022',
      sourcemap: true,
      // Sin estilos inline en el HTML generado: compatibles con style-src 'self'.
      cssCodeSplit: true,
      assetsInlineLimit: 0,
    },
  };
});
