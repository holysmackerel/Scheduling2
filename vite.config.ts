import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { execSync } from "node:child_process";

const appVersion = process.env.npm_package_version || "0.0.0";
const buildTimeIso = new Date().toISOString();
const buildId = String(Date.now());

let gitSha = "nogit";
try {
  gitSha = execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
} catch {
  gitSha = "nogit";
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: "./",
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
    __BUILD_TIME_ISO__: JSON.stringify(buildTimeIso),
    __BUILD_ID__: JSON.stringify(buildId),
    __GIT_SHA__: JSON.stringify(gitSha),
  },
});
