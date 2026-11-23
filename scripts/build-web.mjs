import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "apps", "web");
const output = join(source, "dist");
const tools = JSON.parse(await readFile(join(root, "shared", "tools.json"), "utf8"));
const uploadedArchive = join(root, "public", "downloads", "VIBE-CODING-WORKSPACE-1.7.3.zip");
const downloadArchive = join(output, "downloads", "vibe-coding-workspace-extension.zip");

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(join(source, "index.html"), join(output, "index.html"));
await cp(join(source, "styles.css"), join(output, "styles.css"));
await cp(join(source, "app.js"), join(output, "app.js"));
await cp(join(source, "favicon.svg"), join(output, "favicon.svg"));
await cp(join(root, "public", "materials"), join(output, "materials"), { recursive: true });
await mkdir(join(output, "downloads"), { recursive: true });
await cp(uploadedArchive, downloadArchive);
await cp(join(root, "docs"), join(output, "docs"), { recursive: true });
await writeFile(join(output, "tools.json"), JSON.stringify(tools, null, 2) + "\n");
console.log(`웹 대시보드 준비 완료: ${output}`);
