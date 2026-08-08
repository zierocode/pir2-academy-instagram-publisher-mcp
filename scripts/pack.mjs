import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8"));
const manifest = JSON.parse(readFileSync(resolve(ROOT, "manifest.json"), "utf8"));
if (pkg.version !== manifest.version) throw new Error("package and manifest versions must match");
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("run through npm so the locked npm CLI is available");
const tooling = resolve(ROOT, "tools/mcpb-cli");
const mcpb = resolve(tooling, "node_modules/@anthropic-ai/mcpb/dist/cli/cli.js");
const stagingRoot = mkdtempSync(resolve(tmpdir(), "pir2-instagram-mcpb-"));
const staging = resolve(stagingRoot, "bundle");
const output = resolve(ROOT, "dist", `pir2-academy-instagram-publisher-${pkg.version}.mcpb`);

function run(command, args, cwd = ROOT) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed\n${result.stdout}\n${result.stderr}`);
}

function normalizeZip(path) {
  const zip = readFileSync(path);
  let offset = 0;
  while (offset + 4 <= zip.length) {
    const signature = zip.readUInt32LE(offset);
    if (signature === 0x04034b50) {
      zip.writeUInt16LE(0, offset + 10); zip.writeUInt16LE(0x0021, offset + 12);
      offset += 30 + zip.readUInt16LE(offset + 26) + zip.readUInt16LE(offset + 28) + zip.readUInt32LE(offset + 18);
    } else if (signature === 0x02014b50) {
      zip.writeUInt16LE(0, offset + 12); zip.writeUInt16LE(0x0021, offset + 14);
      offset += 46 + zip.readUInt16LE(offset + 28) + zip.readUInt16LE(offset + 30) + zip.readUInt16LE(offset + 32);
    } else if (signature === 0x06054b50) break;
    else throw new Error(`unexpected ZIP record at byte ${offset}`);
  }
  writeFileSync(path, zip);
}

try {
  mkdirSync(resolve(staging, "server"), { recursive: true });
  run(process.execPath, [npmCli, "ci", "--ignore-scripts", "--no-audit"], tooling);
  run(process.execPath, [npmCli, "audit", "--audit-level=high"], tooling);
  run(process.execPath, [resolve(ROOT, "node_modules/typescript/bin/tsc"), "-p", "tsconfig.json", "--outDir", resolve(staging, "server"), "--declaration", "false"]);
  for (const [source, target] of [
    ["manifest.json", "manifest.json"], ["assets/icons/icon.png", "icon.png"],
    ["package.json", "package.json"], ["package-lock.json", "package-lock.json"],
  ]) cpSync(resolve(ROOT, source), resolve(staging, target));
  run(process.execPath, [npmCli, "ci", "--omit=dev", "--ignore-scripts", "--no-audit"], staging);
  run(process.execPath, [npmCli, "install", "--ignore-scripts", "--force", "--no-save", "--no-audit",
    "@napi-rs/keyring-darwin-arm64@1.3.0", "@napi-rs/keyring-darwin-x64@1.3.0",
    "@napi-rs/keyring-win32-arm64-msvc@1.3.0", "@napi-rs/keyring-win32-x64-msvc@1.3.0"], staging);
  rmSync(resolve(staging, "package-lock.json"));
  writeFileSync(resolve(staging, "package.json"), `${JSON.stringify({
    name: pkg.name, version: pkg.version, private: true, type: "module", engines: pkg.engines, dependencies: pkg.dependencies,
  }, null, 2)}\n`);
  mkdirSync(dirname(output), { recursive: true });
  rmSync(output, { force: true }); rmSync(`${output}.sha256`, { force: true });
  run(process.execPath, [mcpb, "validate", resolve(staging, "manifest.json")]);
  run(process.execPath, [mcpb, "pack", staging, output]);
  normalizeZip(output);
  const digest = createHash("sha256").update(readFileSync(output)).digest("hex");
  writeFileSync(`${output}.sha256`, `${digest}  ${basename(output)}\n`);
  process.stdout.write(`${output}\n${digest}\n`);
} finally {
  rmSync(stagingRoot, { recursive: true, force: true });
}
