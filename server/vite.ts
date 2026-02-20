import express, { type Express } from "express";
import fs from "fs";
import path from "path";
import { createServer as createViteServer, createLogger } from "vite";
import { type Server } from "http";
import viteConfig from "../vite.config";

const viteLogger = createLogger();
const viteLoggerFailFast = process.env.VITE_LOGGER_FAIL_FAST === "true";
const viteDefaultAllowedHosts = ["localhost", "127.0.0.1", "::1"];
const viteAllowedHostsFromEnv = process.env.VITE_ALLOWED_HOSTS
  ?.split(",")
  .map(host => host.trim())
  .filter(Boolean);
const viteAllowAllHosts = process.env.VITE_DEV_PUBLIC === "true";

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

export async function setupVite(app: Express, _server: Server) {
  const allowedHosts: true | string[] = viteAllowAllHosts
    ? true
    : (viteAllowedHostsFromEnv?.length ? viteAllowedHostsFromEnv : viteDefaultAllowedHosts);

  const serverOptions = {
    middlewareMode: true,
    hmr: false,
    allowedHosts,
  };

  const vite = await createViteServer({
    ...viteConfig,
    configFile: false,
    customLogger: {
      ...viteLogger,
      error: (msg, options) => {
        viteLogger.error(msg, options);
        if (viteLoggerFailFast) {
          process.exit(1);
        }
      },
    },
    server: serverOptions,
    appType: "custom",
  });

  // Serve a stub /@vite/client that provides CSS injection helpers
  // but skips the HMR WebSocket setup (prevents console errors in Docker)
  app.get('/@vite/client', (_req, res) => {
    res.set('Content-Type', 'application/javascript');
    res.send(`
export function createHotContext() {
  return {
    accept() {}, dispose() {}, prune() {},
    invalidate() {}, on() {}, send() {},
    data: {},
  };
}
export function updateStyle(id, css) {
  let el = document.querySelector(\`[data-vite-dev-id="\${id}"]\`);
  if (!el) {
    el = document.createElement('style');
    el.setAttribute('type', 'text/css');
    el.setAttribute('data-vite-dev-id', id);
    document.head.appendChild(el);
  }
  el.textContent = css;
}
export function removeStyle(id) {
  const el = document.querySelector(\`[data-vite-dev-id="\${id}"]\`);
  if (el) el.remove();
}
export function injectQuery(url) { return url; }
    `);
  });

  app.use(vite.middlewares);
  app.use("*", async (req, res, next) => {
    const url = req.originalUrl;

    try {
      const clientTemplate = path.resolve(
        import.meta.dirname,
        "..",
        "client",
        "index.html",
      );

      // always reload the index.html file from disk incase it changes
      const template = await fs.promises.readFile(clientTemplate, "utf-8");
      const page = await vite.transformIndexHtml(url, template);
      res.status(200).set({ "Content-Type": "text/html" }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e as Error);
      next(e);
    }
  });
}

export function serveStatic(app: Express) {
  const distPath = path.resolve(import.meta.dirname, "public");

  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  app.use(express.static(distPath));

  // fall through to index.html if the file doesn't exist
  app.use("*", (_req, res) => {
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
