import { runStdioServer } from "./server.js";

export { buildServerIdentity, createMcpServer, createToolCatalog } from "./server.js";

if (process.argv[1]?.endsWith("index.js")) {
  void runStdioServer().catch(() => {
    process.exitCode = 1;
  });
}
