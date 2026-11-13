import { randomBytes, createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile, rename, rm, lstat } from "node:fs/promises";
import { resolve, join } from "node:path";
import { spawnSync } from "node:child_process";

export async function initialize({ cwd = process.cwd(), broker = true, runtime = "docker", env = process.env } = {}) {
  const root = resolve(cwd), target = join(root, ".runtime"), envFile = join(root, ".env");
  for (const path of [target, envFile]) {
    try { await lstat(path); throw Error("configuration_exists"); }
    catch (e) { if (e.code !== "ENOENT") throw e; }
  }
  const port = (key, fallback) => {
    const value = env[key] ?? fallback;
    if (!/^[0-9]{1,5}$/.test(String(value)) || Number(value) < 1 || Number(value) > 65535) throw Error("invalid_port");
    return Number(value);
  };
  const apiPort = port("USAGE_PORT", 8788), tcpPort = port("MQTT_TCP_PORT", 1883), wsPort = port("MQTT_WS_PORT", 9001);
  if (new Set([apiPort, tcpPort, wsPort]).size !== 3) throw Error("ports_must_differ");
  const origin = env.USAGE_PUBLIC_ORIGIN ?? "https://usage.example.invalid";
  if (new URL(origin).protocol !== "https:" || new URL(origin).origin !== origin) throw Error("invalid_origin");
  if (!["docker", "podman", "native"].includes(runtime)) throw Error("invalid_runtime");
  const uid = process.getuid(), gid = process.getgid();
  const stage = join(root, `.runtime-${randomUUID()}.tmp`);
  const secret = () => randomBytes(32).toString("base64url");
  const hash = (s) => createHash("sha256").update(s).digest("hex");
  const collector = secret(), reader = secret(), password = secret();
  let envCreated = false;
  try {
    for (const dir of ["", "config", "state", "broker-config", "broker-data", "collectors"])
      await mkdir(join(stage, dir), { recursive: true, mode: 0o700 });
    const write = (name, value) => writeFile(join(stage, name), value, { mode: 0o600, flag: "wx" });
    const json = (name, value) => write(name, JSON.stringify(value, null, 2) + "\n");
    await json("config/collector-hashes.json", { desk: hash(collector) });
    await json("config/reader-hashes.json", [hash(reader)]);
    await write("collectors/desk.token", collector + "\n");
    await write("reader.token", reader + "\n");
    await json("config/publisher.json", { username: "usage-publisher", password });
    const common = {
      preferredSources: Object.fromEntries(["claude", "codex", "antigravity", "opencode_go", "hermes_nous", "grok"].map((provider) => [provider, ["desk"]])),
      mqtt: { enabled: broker, url: `mqtt://127.0.0.1:${tcpPort}`, topicPrefix: "ai-usage/v1/main", credentialsFile: "/config/publisher.json" },
      gateway: { enabled: broker, url: `ws://127.0.0.1:${wsPort}/mqtt`, maxConnections: 8 },
    };
    await json("config/config.json", common);
    await json("config/native.json", { ...common, mqtt: { ...common.mqtt, credentialsFile: join(target, "config/publisher.json") } });
    const native = {
      USAGE_PORT: apiPort, USAGE_PUBLIC_ORIGIN: origin,
      USAGE_AUTH_MODULE: join(root, "dist/usage/auth-tailscale.mjs"),
      USAGE_CONFIG: join(target, "config/native.json"),
      USAGE_STATE_FILE: join(target, "state/state.json"),
      USAGE_COLLECTOR_TOKENS_FILE: join(target, "config/collector-hashes.json"),
      USAGE_READER_TOKENS_FILE: join(target, "config/reader-hashes.json"),
    };
    await write("native.env", Object.entries(native).map(([k, v]) => `${k}=${JSON.stringify(String(v))}`).join("\n") + "\n");
    const topics = ["state", "heartbeat", "availability"].map((name) => `ai-usage/v1/main/usage/${name}`);
    await write("broker-config/publisher.acl", "user usage-publisher\n" + topics.map((t) => `topic write ${t}`).join("\n") + "\n");
    await write("broker-config/reader.acl", topics.map((t) => `topic read ${t}`).join("\n") + "\n");
    await write("broker-config/mosquitto.conf", `per_listener_settings true\nlistener ${tcpPort} 127.0.0.1\nallow_anonymous false\npassword_file /mosquitto/config/passwords\nacl_file /mosquitto/config/publisher.acl\nlistener ${wsPort} 127.0.0.1\nprotocol websockets\nallow_anonymous true\nacl_file /mosquitto/config/reader.acl\npersistence true\npersistence_location /mosquitto/data/\nlog_dest stdout\n`);
    if (broker) {
      // -U hashes an owner-only password file in place. No secret goes into
      // command arguments, environment variables or logs.
      await write("broker-config/passwords", `usage-publisher:${password}\n`);
      const args = runtime === "native"
        ? ["-U", join(stage, "broker-config/passwords")]
        : ["run", "--rm", "--network=none", ...(runtime === "podman" ? ["--userns=keep-id"] : []), "--user", `${uid}:${gid}`, "--entrypoint", "mosquitto_passwd", "-v", `${join(stage, "broker-config")}:/work`, "eclipse-mosquitto:2", "-U", "/work/passwords"];
      const command = runtime === "native" ? "mosquitto_passwd" : runtime;
      const result = spawnSync(command, args, { encoding: "utf8", timeout: 120000 });
      if (result.error || result.status !== 0) throw Error("broker_password_setup_failed");
    }
    await writeFile(envFile, `USAGE_UID=${uid}\nUSAGE_GID=${gid}\nUSAGE_PORT=${apiPort}\nUSAGE_PUBLIC_ORIGIN=${origin}\n`, { mode: 0o600, flag: "wx" });
    envCreated = true;
    await rename(stage, target);
    return { directory: target, broker, port: apiPort };
  } catch (e) {
    await rm(stage, { recursive: true, force: true });
    if (envCreated) await rm(envFile, { force: true });
    throw e;
  }
}
if (process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  try {
    const args = process.argv.slice(2);
    const at = args.indexOf("--runtime");
    const result = await initialize({ broker: !args.includes("--no-broker"), runtime: at >= 0 ? args[at + 1] : "docker" });
    console.log(`Initialized ${result.directory}; broker=${result.broker}; API loopback port ${result.port}. Credentials were written to owner-only files.`);
  } catch (e) {
    console.error(`Initialization failed (${e instanceof Error ? e.message : "configuration"}). No secrets were printed.`);
    process.exitCode = 1;
  }
}
