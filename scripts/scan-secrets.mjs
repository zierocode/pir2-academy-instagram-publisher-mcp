import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tracked = spawnSync("git", ["ls-files", "-z"], { cwd: root, encoding: "buffer" });
if (tracked.status !== 0) throw new Error("git ls-files failed");
const patterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u,
  /META_APP_SECRET\s*=\s*[^<\s]/u,
  /(?:EAAB|EAAJ|IGQ)[A-Za-z0-9_-]{24,}/u,
];
const findings = [];
for (const relative of tracked.stdout.toString("utf8").split("\0").filter(Boolean)) {
  if (relative.endsWith("package-lock.json") || /\.(?:png|jpg|jpeg|mcpb)$/iu.test(relative)) continue;
  const body = readFileSync(resolve(root, relative), "utf8");
  for (const pattern of patterns) if (pattern.test(body)) findings.push(relative);
}
if (findings.length) throw new Error(`secret scan failed: ${[...new Set(findings)].join(", ")}`);
process.stdout.write("tracked secret scan passed\n");
