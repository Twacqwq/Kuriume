import { fileURLToPath } from "url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import tailwindcss from "@tailwindcss/vite";

const host = process.env.TAURI_DEV_HOST;

// The lazy full HLS build is ~592 kB. The light build removes playback
// capabilities, so budget it separately without relaxing application chunks.
const APP_CHUNK_KB = 500;
const HLS_CHUNK_KB = 650;
function bundleSizeBudget(): Plugin {
  return {
    name: "kuriume-bundle-budget",
    apply: "build",
    generateBundle(_options, bundle) {
      const chunks = Object.values(bundle).filter((item) => item.type === "chunk");
      for (const chunk of chunks) {
        const modules = Object.keys(chunk.modules);
        const isHlsModule = (id: string) => /[/\\]node_modules[/\\]hls\.js[/\\]/.test(id);
        const containsHls = modules.some(isHlsModule);
        if (containsHls && (!modules.every(isHlsModule) || !chunk.isDynamicEntry ||
          chunks.some((other) => other.imports.includes(chunk.fileName)))) {
          this.error("Keep the full HLS library in its own dynamically imported chunk.");
        }
        const limit = containsHls ? HLS_CHUNK_KB : APP_CHUNK_KB;
        const size = Buffer.byteLength(chunk.code, "utf8");
        if (size > limit * 1000) {
          this.error(`${chunk.fileName}: ${(size / 1000).toFixed(1)} kB exceeds its ${limit} kB budget.`);
        }
      }
    },
  };
}

export default defineConfig(async () => ({
  envPrefix: ["VITE_", "TAURI_ENV_PLATFORM"],
  // Match the mobile WebView baseline; keep the existing desktop build target.
  build: {
    // The plugin enforces the original 500 kB cap for every non-HLS chunk.
    chunkSizeWarningLimit: HLS_CHUNK_KB,
    target: process.env.TAURI_ENV_PLATFORM === "ios" ? "safari16.4"
      : process.env.TAURI_ENV_PLATFORM === "android" ? "chrome111" : undefined,
  },
  plugins: [
    tanstackRouter({
      target: "react",
      autoCodeSplitting: true,
    }),
    react(),
    tailwindcss(),
    bundleSizeBudget(),
  ],

  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },

  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
}));
