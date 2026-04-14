import { defineConfig } from 'vite';

export default defineConfig({
  // Base path para GitHub Pages.
  // El repo vive en j03rul4nd.github.io/digital-twin-water/
  // Con base: '/' los assets fallan en producción (404 en JS/CSS).
  // Con base: '/digital-twin-water/' funciona en GitHub Pages Y en local
  // porque Vite dev server lo respeta también.
  //
  // Para Vercel o dominio propio: cambiar a base: '/'
  base: '/digital-twin-water/',

  build: {
    outDir: 'dist',
    // Three.js tiene módulos grandes — evitar warnings falsos en el build
    chunkSizeWarningLimit: 1500,
  },

  server: {
    port: 5173,
    open: true,
  },

  worker: {
    // Necesario para que sensor.worker.js use import de ES Modules.
    // Sin esto Vite trata el Worker como script clásico y los imports fallan.
    format: 'es',
  },

  optimizeDeps: {
    // mqtt usa `await import('mqtt')` dinámico en MQTTAdapter.
    // Sin include explícito, Vite puede no pre-bundlearlo en dev mode
    // y el import falla en runtime aunque el paquete esté instalado.
    include: ['mqtt'],
  },
});