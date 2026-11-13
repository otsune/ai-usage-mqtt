import { expect, it } from "vitest";
import { extractLegacyUsage, mergeUsageIntoLegacy } from "../../services/usage/src/migrate";
import { usageEnvelope } from "../helpers/usage";
it("round-trips legacy usage while retaining unrelated consumer fields without importing a dashboard", () => {
  const envelope = usageEnvelope(7);
  const legacy = {
    dashboard: { schemaVersion: 1, usage: [envelope.payload], weather: { preserved: true }, rss: [] },
    usageSequences: { "claude:desk": envelope },
    usageValues: { "claude:desk": envelope.payload },
    usageObservedAt: {},
  };
  const usage = extractLegacyUsage(legacy);
  const restored = mergeUsageIntoLegacy(legacy, usage) as typeof legacy;
  expect(restored.dashboard.weather).toEqual(legacy.dashboard.weather);
  expect(restored.dashboard.rss).toEqual([]);
  expect(restored.usageSequences).toEqual(legacy.usageSequences);
  expect(restored.dashboard.usage).toEqual(legacy.dashboard.usage);
});
