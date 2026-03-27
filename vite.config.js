import { defineConfig } from 'vite';

export default defineConfig({
  // Base path para GitHub Pages.
  // Si el repo se llama "digital-twin-water", usar '/digital-twin-water/'.
  // Para Vercel o localhost, '/' funciona siempre.
  base: '/',

  build: {
    // Carpeta de salida del build estático
    outDir: 'dist',

    // Three.js tiene módulos grandes — aumentar el límite del warning
    // para no ver alertas falsas durante el build
    chunkSizeWarningLimit: 1500,
  },

  server: {
    // Puerto fijo para desarrollo (evita que cambie si hay otro proceso)
    port: 5173,
    open: true, // abre el navegador automáticamente al hacer npm run dev
  },

  worker: {
    // Necesario para que sensor.worker.js use 'import' de ES Modules.
    // Sin esto, Vite trata el Worker como script clásico y los imports fallan.
    format: 'es',
  },
});