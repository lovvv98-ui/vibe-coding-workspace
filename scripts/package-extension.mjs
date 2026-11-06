import { createExtensionArchive, extension, archiveName } from "./extension-archive.mjs";
import { join } from "node:path";

const result = await createExtensionArchive(join(extension, archiveName));
console.log(`확장 프로그램 ZIP을 만들었습니다: ${result.destination}`);
console.log(`파일 ${result.files}개 · ${(result.bytes / 1024).toFixed(1)} KB`);
