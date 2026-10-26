import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const artifactDir = fileURLToPath(new URL(".", import.meta.url));

await build({
  absWorkingDir: artifactDir,
  entryPoints: ["src/vercel-handler.ts"],
  outfile: "dist-vercel/handler.cjs",
  platform: "node",
  target: "node22",
  format: "cjs",
  bundle: true,
  // This bundle is exclusively for Vercel. Select its storage path at build
  // time instead of depending on automatic system variables at runtime.
  define: {
    "process.env.NODE_ENV": '"production"',
    "process.env.VERCEL": '"1"',
  },
  external: ["pg-native"],
  logLevel: "info",
});