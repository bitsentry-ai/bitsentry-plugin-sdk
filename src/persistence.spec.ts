import { describe, expect, it } from "vitest";
import {
  assertPluginPersistenceContract,
  desktopCodePluginSchema,
  desktopPluginDescriptorSchema,
  validatePluginConnectionConfig,
  validatePluginResourceState,
  upgradePluginConnectionConfig,
} from "./index";

function example() {
  return desktopCodePluginSchema.parse({
    id: "third-party.example",
    name: "Example",
    version: "1.0.0",
    description: "Example",
    auth: {
      fields: [
        { key: "apiKey", label: "API key", type: "string", secret: true },
      ],
    },
    actions: [
      {
        id: "read",
        title: "Read",
        description: "Read",
        riskLevel: "read",
        fields: [],
        execute: () => ({ ok: true }),
      },
    ],
    metadata: {
      persistence: {
        configVersion: 1,
        configFields: [
          { key: "baseUrl", label: "URL", type: "string", required: true },
          { key: "mapping", label: "Mapping", type: "json" },
        ],
        destinationField: "baseUrl",
        resources: [{ type: "case", stateVersion: 1, readActionId: "read" }],
        eventChannels: ["case.changed"],
      },
    },
    persistence: {
      validateConfig: (config: Record<string, unknown>) => config,
      validateResourceState: ({ state }: { state: unknown }) => state,
    },
  });
}

describe("plugin-owned persistence contract", () => {
  it("round-trips metadata without serializing handlers or adding a provider enum", () => {
    const plugin = example();
    expect(() => {
      assertPluginPersistenceContract(plugin);
    }).not.toThrow();
    const descriptor = desktopPluginDescriptorSchema.parse(plugin);
    const roundTrip = desktopPluginDescriptorSchema.parse(
      JSON.parse(JSON.stringify(descriptor)),
    );
    expect(roundTrip.metadata?.persistence?.resources[0]?.type).toBe("case");
    expect(descriptor).not.toHaveProperty("persistence");
    expect(
      validatePluginConnectionConfig(plugin, 1, {
        baseUrl: "https://example.test",
      }),
    ).toEqual({ baseUrl: "https://example.test" });
  });

  it("rejects undeclared configuration and credentials nested in JSON fields", () => {
    const plugin = example();
    for (const config of [
      { baseUrl: "https://example.test", unexpected: true },
      {
        baseUrl: "https://example.test",
        mapping: { nested: [{ apiKey: "secret" }] },
      },
      { baseUrl: "" },
    ])
      expect(() => validatePluginConnectionConfig(plugin, 1, config)).toThrow(
        "invalid_configuration",
      );
  });

  it("does not execute missing or incompatible plugins", () => {
    expect(() => validatePluginConnectionConfig(undefined, 1, {})).toThrow(
      "plugin_missing",
    );
    expect(() => validatePluginConnectionConfig(example(), 2, {})).toThrow(
      "upgrade_required",
    );
    expect(() => validatePluginResourceState(example(), "case", 2, {})).toThrow(
      "upgrade_required",
    );
  });

  it("requires recovery reads to reference a declared read action", () => {
    const plugin = example();
    plugin.actions[0].riskLevel = "write";
    expect(() => {
      assertPluginPersistenceContract(plugin);
    }).toThrow("invalid_configuration");
  });

  it("revalidates plugin output and keeps exception values out of errors", () => {
    const plugin = example();
    if (plugin.persistence === undefined)
      throw new Error("Missing fixture handlers");
    plugin.persistence.validateConfig = () => ({
      baseUrl: "https://example.test",
      apiKey: "secret",
    });
    expect(() =>
      validatePluginConnectionConfig(plugin, 1, {
        baseUrl: "https://example.test",
      }),
    ).toThrow("invalid_configuration");
    plugin.persistence.validateResourceState = () => {
      throw new Error("secret");
    };
    expect(() => validatePluginResourceState(plugin, "case", 1, {})).toThrow(
      "invalid_configuration",
    );
  });

  it("keeps legacy plugins usable but rejects partially declared persistence", () => {
    const plugin = example();
    delete plugin.persistence;
    expect(() => {
      assertPluginPersistenceContract(plugin);
    }).toThrow("invalid_configuration");
    if (plugin.metadata === undefined)
      throw new Error("Missing fixture metadata");
    delete plugin.metadata.persistence;
    expect(() => {
      assertPluginPersistenceContract(plugin);
    }).not.toThrow();
  });
});

describe("persistence boundary snapshots and explicit upgrades", () => {
  it("sanitizes throwing input traps and snapshots handler getters", () => {
    const plugin = example();
    const hostile = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error("secret");
        },
      },
    );
    expect(() => validatePluginConnectionConfig(plugin, 1, hostile)).toThrow(
      "invalid_configuration",
    );
    if (plugin.persistence === undefined)
      throw new Error("Missing fixture handlers");
    let reads = 0;
    plugin.persistence.validateConfig = () => ({
      baseUrl: "https://example.test",
      get mapping() {
        reads += 1;
        return reads === 1 ? {} : { apiKey: "secret" };
      },
    });
    const config = validatePluginConnectionConfig(plugin, 1, {
      baseUrl: "https://example.test",
    });
    expect(config.mapping).toEqual({});
    expect(config.mapping).toEqual({});
    expect(reads).toBe(1);
  });

  it("upgrades only explicitly and prevents changing a connection target", () => {
    const plugin = example();
    const contract = plugin.metadata?.persistence;
    if (contract === undefined || plugin.persistence === undefined)
      throw new Error("Missing fixture contract");
    contract.configVersion = 2;
    plugin.persistence.upgradeConfig = ({ config }) => ({ version: 2, config });
    const config = { baseUrl: "https://example.test" };
    expect(() => validatePluginConnectionConfig(plugin, 1, config)).toThrow(
      "upgrade_required",
    );
    expect(
      upgradePluginConnectionConfig(plugin, 1, config, config.baseUrl),
    ).toEqual({ version: 2, config });
    expect(() =>
      upgradePluginConnectionConfig(
        plugin,
        1,
        config,
        "https://different.test",
      ),
    ).toThrow("invalid_configuration");
  });
});
