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
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) invalid();
  for (const [key, item] of Object.entries(value)) {
    if (
      credentialKeys.has(key) ||
      ["__proto__", "constructor", "prototype"].includes(key)
    )
      invalid();
    validateJson(item, credentialKeys, depth + 1);
  }
}

/** Use on persistence writes and again before connection execution. */
export function validatePluginConnectionConfig(
  plugin: DesktopCodePlugin | undefined,
  version: number,
  input: unknown,
): Record<string, unknown> {
  if (plugin === undefined) throw new PluginPersistenceError("plugin_missing");
  const contract = requirePluginPersistence(plugin);
  if (version !== contract.configVersion)
    throw new PluginPersistenceError("upgrade_required");
  if (plugin.persistence === undefined) invalid();
  const credentialKeys = new Set(plugin.auth.fields.map((field) => field.key));
  const validateShape = (value: unknown): Record<string, unknown> => {
    validateJson(value, credentialKeys);
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
  };
  const config = validateShape(input);
  try {
    return validateShape(
      plugin.persistence.validateConfig(structuredClone(config)),
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
    validateJson(state, credentialKeys);
    const result = plugin.persistence.validateResourceState({
      resourceType,
      version,
      state: structuredClone(state),
    });
    validateJson(result, credentialKeys);
    return result;
  } catch {
    return invalid();
  }
}
