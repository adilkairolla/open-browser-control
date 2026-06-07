import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import webExtension from "vite-plugin-web-extension";

const stub = path.resolve(__dirname, "src/sidepanel/lib/empty-stub.ts");

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    webExtension({ manifest: "manifest.json" }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src/sidepanel"),
      // Stub node-only deps pulled transitively by pi-ai (bedrock/proxy paths).
      "@aws-sdk/client-bedrock-runtime": stub,
      "@smithy/node-http-handler": stub,
      "http-proxy-agent": stub,
      "https-proxy-agent": stub,
    },
  },
  define: {
    // pi modules occasionally read process.env.* directly; provide a safe shim.
    "process.env": "{}",
    global: "globalThis",
  },
});
