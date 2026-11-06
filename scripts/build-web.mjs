import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createExtensionArchive, archiveName } from "./extension-archive.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "apps", "web");
const output = join(source, "dist");
const tools = JSON.parse(await readFile(join(root, "shared", "tools.json"), "utf8"));

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(join(source, "index.html"), join(output, "index.html"));
await cp(join(source, "styles.css"), join(output, "styles.css"));
await cp(join(source, "app.js"), join(output, "app.js"));
await cp(join(source, "favicon.svg"), join(output, "favicon.svg"));
await mkdir(join(output, "downloads"), { recursive: true });
await cp(join(root, "docs"), join(output, "docs"), { recursive: true });
await writeFile(join(output, "tools.json"), `${JSON.stringify(tools, null, 2)}\n`);
await createExtensionArchive(join(output, "downloads", archiveName));
console.log(`웹 대시보드 준비 완료: ${output}`);
