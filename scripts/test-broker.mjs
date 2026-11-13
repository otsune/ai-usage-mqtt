import { spawnSync } from "node:child_process";
const result = spawnSync(process.execPath, ["node_modules/vitest/vitest.mjs", "run", "tests/integration/standalone-broker.test.ts"], { stdio: "inherit", env: { ...process.env, STANDALONE_BROKER_TEST: "1" } });
process.exitCode = result.status ?? 1;
