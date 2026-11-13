import { expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import net from "node:net";
import { randomUUID } from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import mqtt from "mqtt";
import { initialize } from "../../scripts/init.mjs";
import { usageEnvelope } from "../helpers/usage";

it.skipIf(process.env.STANDALONE_BROKER_TEST !== "1")("runs the generated broker and bundled API without any display software", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "standalone-broker-"));
  const name = "standalone-usage-" + randomUUID();
  const reservations = await Promise.all(Array.from({ length: 3 }, () => new Promise<net.Server>((resolve, reject) => {
    const server = net.createServer(); server.once("error", reject); server.listen(0, "127.0.0.1", () => resolve(server));
  })));
  const [port, tcp, ws] = reservations.map((s) => (s.address() as net.AddressInfo).port);
  let api: ReturnType<typeof spawn> | undefined;
  let started = false;
  const clients: mqtt.MqttClient[] = [];
  const podman = (...args: string[]) => execFileSync("podman", args, { encoding: "utf8", timeout: 30000 });
  async function waitFor<T>(fn: () => Promise<T>): Promise<T> {
    let error: unknown;
    for (let i = 0; i < 100; i++) { try { return await fn(); } catch (e) { error = e; await new Promise((r) => setTimeout(r, 100)); } }
    throw error;
  }
  async function retained(url: string, headers?: Record<string, string>) {
    const client = mqtt.connect(url, { protocolVersion: 4, clean: true, reconnectPeriod: 0, connectTimeout: 3000, wsOptions: { headers } });
    clients.push(client);
    return new Promise<{ streamId: string; revision: string }>((resolve, reject) => {
      const timer = setTimeout(() => reject(Error("retained_timeout")), 5000);
      client.once("error", (e) => { clearTimeout(timer); reject(e); });
      client.once("connect", () => client.subscribe("ai-usage/v1/main/usage/state", { qos: 1 }));
      client.once("message", (_t, bytes, packet) => { clearTimeout(timer); expect(packet.retain).toBe(true); resolve(JSON.parse(bytes.toString())); });
    });
  }
  try {
    await initialize({ cwd, runtime: "podman", env: { USAGE_PORT: String(port), MQTT_TCP_PORT: String(tcp), MQTT_WS_PORT: String(ws) } });
    const hashes = await readFile(join(cwd, ".runtime/broker-config/passwords"), "utf8");
    expect(hashes).toMatch(/^usage-publisher:\$7\$/);
    await Promise.all(reservations.map((s) => new Promise<void>((r) => s.close(() => r()))));
    podman("run", "-d", "--pull=never", "--name", name, "--network=host", "--userns=keep-id", "--user", `${process.getuid!()}:${process.getgid!()}`, "-v", `${join(cwd, ".runtime/broker-config")}:/mosquitto/config:ro`, "-v", `${join(cwd, ".runtime/broker-data")}:/mosquitto/data`, "eclipse-mosquitto:2");
    started = true;
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("FIRE_") && !key.startsWith("USAGE_")));
    env.USAGE_AUTH_MODULE = resolve("dist/usage/auth-tailscale.mjs");
    api = spawn(process.execPath, ["--env-file=" + join(cwd, ".runtime/native.env"), resolve("dist/usage/start.mjs")], { cwd, env, stdio: "ignore" });
    const reader = (await readFile(join(cwd, ".runtime/reader.token"), "utf8")).trim();
    const collector = (await readFile(join(cwd, ".runtime/collectors/desk.token"), "utf8")).trim();
    const base = `http://127.0.0.1:${port}`;
    const request = (path: string, token = reader, init: RequestInit = {}) => fetch(base + path, { ...init, headers: { Authorization: `Bearer ${token}`, ...init.headers }, signal: AbortSignal.timeout(2000) });
    await waitFor(async () => { expect((await request("/api/v1/health")).status).toBe(200); });
    expect((await fetch(base + "/api/v1/usage")).status).toBe(401);
    expect((await request("/api/v1/usage", reader, { method: "POST", body: "{}", headers: { "Content-Type": "application/json" } })).status).toBe(403);
    expect((await request("/api/v1/usage", collector)).status).toBe(403);
    expect((await request("/api/v1/usage", collector, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(usageEnvelope(1)) })).status).toBe(200);
    await waitFor(async () => { const status = await (await request("/api/v1/mqtt-status")).json(); expect(status.runtime.connected).toBe(true); expect(status.runtime.lastPublishRevision).toBe("1"); });
    const http = await (await request("/api/v1/usage")).json();
    const direct = await retained(`ws://127.0.0.1:${ws}/mqtt`);
    expect(direct.streamId).toBe(http.streamId); expect(direct.revision).toBe("1");
    const gateway = await retained(`ws://127.0.0.1:${port}/api/v1/usage/stream`, { Authorization: `Bearer ${reader}`, Origin: "https://usage.example.invalid" });
    expect(gateway).toMatchObject({ streamId: http.streamId, revision: "1" });
    podman("restart", name);
    expect((await request("/api/v1/usage", collector, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(usageEnvelope(2)) })).status).toBe(200);
    await waitFor(async () => { const status = await (await request("/api/v1/mqtt-status")).json(); expect(status.runtime.connected).toBe(true); expect(status.runtime.lastPublishRevision).toBe("2"); });
    expect((await retained(`ws://127.0.0.1:${ws}/mqtt`)).revision).toBe("2");
  } finally {
    clients.forEach((c) => c.end(true));
    if (api) { api.kill("SIGTERM"); await new Promise((r) => { if (api!.exitCode !== null) r(null); else { api!.once("exit", r); setTimeout(() => { api!.kill("SIGKILL"); r(null); }, 3000).unref(); } }); }
    if (started) podman("rm", "-f", name);
    for (const server of reservations) if (server.listening) server.close();
    await rm(cwd, { recursive: true, force: true });
  }
}, 60000);
