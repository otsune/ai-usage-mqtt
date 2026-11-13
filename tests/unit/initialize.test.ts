import { afterEach, expect, it } from "vitest";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { initialize } from "../../scripts/init.mjs";

const dirs: string[] = [];
async function directory() { const path = await mkdtemp(join(tmpdir(), "usage-init-")); dirs.push(path); return path; }
afterEach(async () => { for (const path of dirs.splice(0)) await rm(path, { recursive: true, force: true }); });
it("initializes standalone HTTP credentials in private files and separates collector/reader roles", async () => {
  const cwd = await directory();
  await initialize({ cwd, broker: false, env: { USAGE_PORT: "18790" } });
  const config = JSON.parse(await readFile(join(cwd, ".runtime/config/native.json"), "utf8"));
  expect(config.mqtt.enabled).toBe(false);
  expect(config.preferredSources.claude).toEqual(["desk"]);
  const collector = (await readFile(join(cwd, ".runtime/collectors/desk.token"), "utf8")).trim();
  const reader = (await readFile(join(cwd, ".runtime/reader.token"), "utf8")).trim();
  expect(reader).not.toBe(collector);
  const hash = (s: string) => createHash("sha256").update(s).digest("hex");
  expect(JSON.parse(await readFile(join(cwd, ".runtime/config/collector-hashes.json"), "utf8"))).toEqual({ desk: hash(collector) });
  expect(JSON.parse(await readFile(join(cwd, ".runtime/config/reader-hashes.json"), "utf8"))).toEqual([hash(reader)]);
  expect((await stat(join(cwd, ".runtime/reader.token"))).mode & 0o777).toBe(0o600);
  expect((await stat(join(cwd, ".runtime"))).mode & 0o777).toBe(0o700);
});
it("refuses to overwrite configuration even when only .env exists", async () => {
  const cwd = await directory();
  await writeFile(join(cwd, ".env"), "existing\n");
  await expect(initialize({ cwd, broker: false })).rejects.toThrow("configuration_exists");
  expect(await readFile(join(cwd, ".env"), "utf8")).toBe("existing\n");
});
it("rejects colliding listener ports before creating configuration", async () => {
  const cwd = await directory();
  await expect(initialize({ cwd, broker: false, env: { USAGE_PORT: "1883" } })).rejects.toThrow("ports_must_differ");
  await expect(stat(join(cwd, ".runtime"))).rejects.toThrow();
});
