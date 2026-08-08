import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8"));
const name = `pir2-academy-instagram-publisher-${pkg.version}.mcpb`;
const bundle = resolve(ROOT, "dist", name);
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("run through npm so the locked npm CLI is available");
const tooling = resolve(ROOT, "tools/mcpb-cli");
const mcpb = resolve(tooling, "node_modules/@anthropic-ai/mcpb/dist/cli/cli.js");
const unpackRoot = mkdtempSync(resolve(tmpdir(), "pir2-instagram-verify-"));
const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const path = resolve(dir, entry.name); return entry.isDirectory() ? walk(path) : [path];
});

try {
  if (!existsSync(bundle) || !existsSync(`${bundle}.sha256`)) throw new Error("bundle or checksum missing");
  const expected = readFileSync(`${bundle}.sha256`, "utf8").trim().split(/\s+/)[0];
  const actual = createHash("sha256").update(readFileSync(bundle)).digest("hex");
  if (expected !== actual) throw new Error("SHA-256 mismatch");
  const result = spawnSync(process.execPath, [mcpb, "unpack", bundle, unpackRoot], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`unpack failed\n${result.stderr}`);
  const roots = readdirSync(unpackRoot).map((entry) => resolve(unpackRoot, entry));
  const root = roots.length === 1 && statSync(roots[0]).isDirectory() ? roots[0] : unpackRoot;
  const allowed = new Set(["manifest.json", "icon.png", "package.json", "server", "node_modules"]);
  for (const entry of readdirSync(root)) if (!allowed.has(entry)) throw new Error(`unexpected bundle entry: ${entry}`);
  const serverFiles = walk(resolve(root, "server"));
  if (serverFiles.length === 0 || serverFiles.some((path) => !path.endsWith(".js"))) throw new Error("server must contain compiled JS only");
  const manifest = JSON.parse(readFileSync(resolve(root, "manifest.json"), "utf8"));
  const tools = ["instagram_auth_status", "connect_instagram", "prepare_instagram_post", "publish_instagram_post"];
  if (JSON.stringify(manifest.tools.map((tool) => tool.name)) !== JSON.stringify(tools)) throw new Error("tool manifest drift");
  for (const native of ["keyring-darwin-arm64", "keyring-darwin-x64", "keyring-win32-arm64-msvc", "keyring-win32-x64-msvc"]) {
    if (!existsSync(resolve(root, "node_modules/@napi-rs", native))) throw new Error(`missing ${native}`);
  }
  const forbiddenName = /(^|\/)(\.env(?:\.|$)|credentials\.json$|tokens?\.json$)/iu;
  const forbiddenContent = /(META_APP_SECRET\s*=|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|EA[A-Za-z0-9]{30,})/u;
  for (const path of walk(root)) {
    const rel = relative(root, path).replaceAll("\\", "/");
    if (forbiddenName.test(rel)) throw new Error(`credential-like file: ${rel}`);
    if (!rel.startsWith("node_modules/") && statSync(path).size < 2_000_000) {
      const body = readFileSync(path); if (!body.includes(0) && forbiddenContent.test(body.toString("utf8"))) throw new Error(`credential-like content: ${rel}`);
    }
  }
  process.stdout.write(`bundle verified: ${name}\n`);
} finally { rmSync(unpackRoot, { recursive: true, force: true }); }
