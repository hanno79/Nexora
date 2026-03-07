import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

export default defineConfig({
  plugins: [
    react(),
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer(),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  root: path.resolve(import.meta.dirname, "client"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // ÄNDERUNG 06.03.2026: Vendor-Aufteilung reduziert die Größe des initialen Frontend-Chunks.
        manualChunks(id) {
          if (!id.includes("node_modules")) {
            return undefined;
          }

          if (id.includes("@clerk")) {
            return "vendor-clerk";
          }

          if (
            id.includes("/node_modules/react/") ||
            id.includes("\\node_modules\\react\\") ||
            id.includes("/node_modules/react-dom/") ||
            id.includes("\\node_modules\\react-dom\\") ||
            id.includes("/node_modules/scheduler/") ||
            id.includes("\\node_modules\\scheduler\\")
          ) {
            return "vendor-react";
          }

          if (id.includes("@tanstack/")) {
            return "vendor-query";
          }

          if (id.includes("lucide-react") || id.includes("react-icons")) {
            return "vendor-icons";
          }

          if (
            id.includes("react-markdown") ||
            id.includes("remark-") ||
            id.includes("rehype-") ||
            id.includes("unified") ||
            id.includes("mdast") ||
            id.includes("hast")
          ) {
            return "vendor-markdown";
          }

          if (
            id.includes("recharts") ||
            id.includes("victory-vendor") ||
            id.includes("react-smooth") ||
            id.includes("d3-")
          ) {
            return "vendor-charts";
          }

          if (id.includes("framer-motion") || id.includes("motion-dom") || id.includes("motion-utils")) {
            return "vendor-motion";
          }

          if (id.includes("@radix-ui")) {
            return "vendor-radix";
          }

          if (id.includes("react-day-picker") || id.includes("date-fns")) {
            return "vendor-date";
          }

          return "vendor";
        },
      },
    },
  },
  server: {
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
});
