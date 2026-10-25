import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const artifactDir = fileURLToPath(new URL(".", import.meta.url));

await build({
  absWorkingDir: artifactDir,
  entryPoints: ["src/vercel-entry.ts"],
  outfile: "dist-vercel/handler.cjs",
  platform: "node",
  target: "node22",
  format: "cjs",
  bundle: true,
  define: { "process.env.NODE_ENV": '"production"' },
  external: ["pg-native"],
  logLevel: "info",
});