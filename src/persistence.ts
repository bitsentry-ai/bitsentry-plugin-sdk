import type {
  DesktopCodePlugin,
  DesktopPluginDescriptor,
  DesktopPluginFieldDefinition,
  DesktopPluginPersistence,
} from "./index";

export type ConnectionAvailability =
  "available" | "plugin_missing" | "upgrade_required" | "invalid_configuration";

/** Stable errors never contain plugin exceptions or configuration values. */
export class PluginPersistenceError extends Error {
  constructor(readonly code: Exclude<ConnectionAvailability, "available">) {
    super(code);
    this.name = "PluginPersistenceError";
  }
}

function invalid(): never {
  throw new PluginPersistenceError("invalid_configuration");
}

/** Legacy plugins remain loadable; opt-in contracts must be complete. */
export function assertPluginPersistenceContract(
  plugin: DesktopCodePlugin,
): void {
  if (
    plugin.metadata?.persistence === undefined &&
    plugin.persistence === undefined
  )
    return;
  requirePluginPersistence(plugin);
  if (plugin.persistence === undefined) invalid();
}

export function requirePluginPersistence(
  descriptor: DesktopPluginDescriptor,
): DesktopPluginPersistence {
  const contract = descriptor.metadata?.persistence;
  if (contract === undefined)
    throw new PluginPersistenceError("upgrade_required");
  const authKeys = new Set(descriptor.auth.fields.map((field) => field.key));
  if (contract.configFields.some((field) => authKeys.has(field.key))) invalid();
  const actionIds = descriptor.actions.map((action) => action.id);
  if (new Set(actionIds).size !== actionIds.length) invalid();
  for (const resource of contract.resources) {
    const action = descriptor.actions.find(
      (candidate) => candidate.id === resource.readActionId,
    );
    if (action?.riskLevel !== "read") invalid();
  }
  return contract;
}

function matchesField(
  field: DesktopPluginFieldDefinition,
  value: unknown,
): boolean {
  switch (field.type) {
    case "string":
      return (
        typeof value === "string" &&
        (field.enumValues === undefined || field.enumValues.includes(value))
      );
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "boolean":
      return typeof value === "boolean";
    case "string_array":
      return (
        Array.isArray(value) && value.every((item) => typeof item === "string")
      );
    case "json":
      return true;
  }
}

/**
 * A plain object has no prototype or the root prototype of its realm. Comparing with this module's own
 * `Object.prototype` would refuse a plain object that was created or cloned in another realm (a worker context, a
 * test sandbox), while a class instance still has a prototype that itself has a prototype.
 */
function isPlainObject(value: object): boolean {
  const prototype: unknown = Object.getPrototypeOf(value);
  return (
    prototype === null ||
    (typeof prototype === "object" && Object.getPrototypeOf(prototype) === null)
  );
}

function validateJson(
  value: unknown,
  credentialKeys: Set<string>,
  depth = 0,
): void {
  // Bounded traversal rejects cycles as well as non-JSON values.
  if (depth > 32) invalid();
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (Array.isArray(value)) {
    for (const item of value) validateJson(item, credentialKeys, depth + 1);
    return;
  }
  if (typeof value !== "object") invalid();
  if (!isPlainObject(value)) invalid();
  for (const [key, item] of Object.entries(value)) {
    if (
      credentialKeys.has(key) ||
      ["__proto__", "constructor", "prototype"].includes(key)
    )
      invalid();
    validateJson(item, credentialKeys, depth + 1);
  }
}

/** Descriptor-only validation for API/UI admission; execution also runs the plugin validator. */
export function validatePluginConnectionShape(
  descriptor: DesktopPluginDescriptor,
  version: number,
  input: unknown,
): Record<string, unknown> {
  const contract = requirePluginPersistence(descriptor);
  if (version !== contract.configVersion)
    throw new PluginPersistenceError("upgrade_required");
  try {
    const value: unknown = structuredClone(input);
    validateJson(
      value,
      new Set(descriptor.auth.fields.map((field) => field.key)),
    );
    if (value === null || typeof value !== "object" || Array.isArray(value))
      invalid();
    const record = value as Record<string, unknown>;
    const fields = new Map(
      contract.configFields.map((field) => [field.key, field]),
    );
    if (Object.keys(record).some((key) => !fields.has(key))) invalid();
    for (const field of contract.configFields) {
      if (!Object.prototype.hasOwnProperty.call(record, field.key)) {
        if (field.required) invalid();
      } else if (!matchesField(field, record[field.key])) invalid();
    }
    const destination = record[contract.destinationField];
    if (typeof destination !== "string" || !destination.trim()) invalid();
    return record;
  } catch {
    return invalid();
  }
}

/** Use on persistence writes and again before connection execution. */
export function validatePluginConnectionConfig(
  plugin: DesktopCodePlugin | undefined,
  version: number,
  input: unknown,
): Record<string, unknown> {
  if (plugin === undefined) throw new PluginPersistenceError("plugin_missing");
  const config = validatePluginConnectionShape(plugin, version, input);
  if (plugin.persistence === undefined) invalid();
  try {
    return validatePluginConnectionShape(
      plugin,
      version,
      plugin.persistence.validateConfig(config),
    );
  } catch {
    return invalid();
  }
}

/** Plugin state is a cache, never an authorization or approval source. */
export function validatePluginResourceState(
  plugin: DesktopCodePlugin | undefined,
  resourceType: string,
  version: number,
  state: unknown,
): unknown {
  if (plugin === undefined) throw new PluginPersistenceError("plugin_missing");
  const resource = requirePluginPersistence(plugin).resources.find(
    (candidate) => candidate.type === resourceType,
  );
  if (resource === undefined) invalid();
  if (resource.stateVersion !== version)
    throw new PluginPersistenceError("upgrade_required");
  if (plugin.persistence === undefined) invalid();
  try {
    const credentialKeys = new Set(
      plugin.auth.fields.map((field) => field.key),
    );
    const snapshot: unknown = structuredClone(state);
    validateJson(snapshot, credentialKeys);
    const result: unknown = structuredClone(
      plugin.persistence.validateResourceState({
        resourceType,
        version,
        state: snapshot,
      }),
    );
    validateJson(result, credentialKeys);
    return result;
  } catch {
    return invalid();
  }
}

/** Explicit upgrade proposal. Ordinary reads/validation never migrate storage. */
export function upgradePluginConnectionConfig(
  plugin: DesktopCodePlugin | undefined,
  version: number,
  input: unknown,
  expectedTarget: string,
): { version: number; config: Record<string, unknown> } {
  if (plugin === undefined) throw new PluginPersistenceError("plugin_missing");
  const contract = requirePluginPersistence(plugin);
  if (
    !Number.isInteger(version) ||
    version < 1 ||
    version >= contract.configVersion ||
    plugin.persistence?.upgradeConfig === undefined
  ) {
    throw new PluginPersistenceError("upgrade_required");
  }
  try {
    const snapshot: unknown = structuredClone(input);
    validateJson(
      snapshot,
      new Set(plugin.auth.fields.map((field) => field.key)),
    );
    if (
      typeof snapshot !== "object" ||
      snapshot === null ||
      Array.isArray(snapshot)
    )
      invalid();
    const upgraded = structuredClone(
      plugin.persistence.upgradeConfig({
        version,
        config: snapshot as Record<string, unknown>,
      }),
    );
    if (upgraded.version !== contract.configVersion) invalid();
    const config = validatePluginConnectionConfig(
      plugin,
      upgraded.version,
      upgraded.config,
    );
    if (config[contract.destinationField] !== expectedTarget) invalid();
    return { version: contract.configVersion, config };
  } catch {
    return invalid();
  }
}

/** Alternative credential sets are plugin vocabulary, never provider switches. */
export function hasPluginCredentials(
  descriptor: DesktopPluginDescriptor,
  values: Record<string, unknown>,
): boolean {
  const present = (key: string) => {
    if (!Object.prototype.hasOwnProperty.call(values, key)) return false;
    const value = values[key];
    return typeof value === "string"
      ? value.trim().length > 0
      : value !== undefined && value !== null;
  };
  return (
    descriptor.auth.fields.every(
      (field) => !field.required || present(field.key),
    ) &&
    (descriptor.auth.requiredSets === undefined ||
      descriptor.auth.requiredSets.some((set) => set.every(present)))
  );
}
