import { build } from "esbuild";
import { readdir } from "node:fs/promises";
const entries = ["services/usage/src/start.ts", "scripts/migrate-usage-state.ts"];
for (const provider of await readdir("collectors")) {
  for (const file of await readdir(`collectors/${provider}`)) {
    if (file.endsWith(".ts")) entries.push(`collectors/${provider}/${file}`);
  }
}
const result = await build({ entryPoints: entries, outdir: "unused", bundle: true, platform: "node", format: "esm", write: false, metafile: true, logLevel: "silent" });
const forbidden = Object.keys(result.metafile.inputs).filter((path) => /(^|\/)(apps|aggregator|react|react-dom|fast-xml-parser)(\/|$)|packages\/contracts\//.test(path));
if (forbidden.length) throw Error(`unexpected Fire dependencies: ${forbidden.join(", ")}`);
console.log(`Independent graph verified: ${entries.length} entries; no Fire UI, API, weather or RSS dependencies.`);
