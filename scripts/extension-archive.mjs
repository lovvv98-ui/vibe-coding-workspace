import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const extension = join(root, "apps", "extension");
const archiveName = "vibe-coding-workspace-extension.zip";

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosTimestamp(date = new Date()) {
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  };
}

async function collectFiles(folder) {
  const entries = await readdir(folder, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name === archiveName || entry.name.startsWith(".")) continue;
    const fullPath = join(folder, entry.name);
    if (entry.isDirectory()) files.push(...await collectFiles(fullPath));
    else if (entry.isFile()) files.push(fullPath);
  }
  return files;
}

function makeLocalHeader(name, data, checksum, timestamp) {
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0x0800, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt16LE(timestamp.time, 10);
  header.writeUInt16LE(timestamp.date, 12);
  header.writeUInt32LE(checksum, 14);
  header.writeUInt32LE(data.length, 18);
  header.writeUInt32LE(data.length, 22);
  header.writeUInt16LE(name.length, 26);
  header.writeUInt16LE(0, 28);
  return header;
}

function makeCentralHeader(name, data, checksum, timestamp, offset) {
  const header = Buffer.alloc(46);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(0x0800, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(timestamp.time, 12);
  header.writeUInt16LE(timestamp.date, 14);
  header.writeUInt32LE(checksum, 16);
  header.writeUInt32LE(data.length, 20);
  header.writeUInt32LE(data.length, 24);
  header.writeUInt16LE(name.length, 28);
  header.writeUInt16LE(0, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE(0, 38);
  header.writeUInt32LE(offset, 42);
  return header;
}

function makeEndRecord(count, centralSize, centralOffset) {
  const record = Buffer.alloc(22);
  record.writeUInt32LE(0x06054b50, 0);
  record.writeUInt16LE(0, 4);
  record.writeUInt16LE(0, 6);
  record.writeUInt16LE(count, 8);
  record.writeUInt16LE(count, 10);
  record.writeUInt32LE(centralSize, 12);
  record.writeUInt32LE(centralOffset, 16);
  record.writeUInt16LE(0, 20);
  return record;
}

export async function createExtensionArchive(destination) {
  const tools = JSON.parse(await readFile(join(root, "shared", "tools.json"), "utf8"));
  const dataFolder = join(extension, "data");
  await mkdir(dataFolder, { recursive: true });
  await writeFile(join(dataFolder, "tools.json"), `${JSON.stringify(tools, null, 2)}\n`);

  const files = await collectFiles(extension);
  const timestamp = dosTimestamp();
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;
  for (const file of files) {
    const name = Buffer.from(relative(extension, file).split(sep).join("/"), "utf8");
    const data = await readFile(file);
    const checksum = crc32(data);
    const localHeader = makeLocalHeader(name, data, checksum, timestamp);
    localParts.push(localHeader, name, data);
    const centralHeader = makeCentralHeader(name, data, checksum, timestamp, localOffset);
    centralParts.push(centralHeader, name);
    localOffset += localHeader.length + name.length + data.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const archive = Buffer.concat([...localParts, centralDirectory, makeEndRecord(files.length, centralDirectory.length, localOffset)]);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, archive);
  return { destination, files: files.length, bytes: archive.length };
}

export { archiveName, extension };
