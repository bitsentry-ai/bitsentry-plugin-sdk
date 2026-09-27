import { z } from "zod";

export const desktopPluginFieldTypeSchema = z.enum([
  "string",
  "number",
  "boolean",
  "json",
  "string_array",
]);

export type DesktopPluginFieldType = z.infer<
  typeof desktopPluginFieldTypeSchema
>;

function isJsonSerializableValue(value: unknown): boolean {
  if (value === null) {
    return true;
  }

  if (typeof value === "string" || typeof value === "boolean") {
    return true;
  }

  if (typeof value === "number") {
    return Number.isFinite(value);
  }

  if (Array.isArray(value)) {
    return value.every((item) => isJsonSerializableValue(item));
  }

  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>).every((item) =>
      isJsonSerializableValue(item),
    );
  }

  return false;
}

export const desktopPluginFieldDefinitionSchema = z
  .object({
    key: z.string().min(1),
    label: z.string().min(1),
    description: z.string().optional(),
    placeholder: z.string().min(1).optional(),
    type: desktopPluginFieldTypeSchema,
    required: z.boolean().default(false),
    secret: z.boolean().optional(),
    defaultValue: z.unknown().optional(),
    enumValues: z.array(z.string().min(1)).min(1).optional(),
  })
  .superRefine((field, context) => {
    if (field.enumValues !== undefined && field.type !== "string") {
      context.addIssue({
        code: "custom",
        path: ["enumValues"],
        message: "enumValues are only supported for string fields.",
      });
    }

    if (field.defaultValue === undefined) {
      return;
    }

    let defaultValueIsValid = false;
    switch (field.type) {
      case "string":
        defaultValueIsValid = typeof field.defaultValue === "string";
        break;
      case "number":
        defaultValueIsValid =
          typeof field.defaultValue === "number" &&
          Number.isFinite(field.defaultValue);
        break;
      case "boolean":
        defaultValueIsValid = typeof field.defaultValue === "boolean";
        break;
      case "string_array":
        defaultValueIsValid =
          Array.isArray(field.defaultValue) &&
          field.defaultValue.every((item) => typeof item === "string");
        break;
      case "json":
        defaultValueIsValid = isJsonSerializableValue(field.defaultValue);
        break;
    }

    if (!defaultValueIsValid) {
      context.addIssue({
        code: "custom",
        path: ["defaultValue"],
        message: `defaultValue must match the "${field.type}" field type.`,
      });
    }

    if (
      field.type === "string" &&
      field.enumValues !== undefined &&
      typeof field.defaultValue === "string" &&
      !field.enumValues.includes(field.defaultValue)
    ) {
      context.addIssue({
        code: "custom",
        path: ["defaultValue"],
        message: "defaultValue must be one of the declared enumValues.",
      });
    }
  });

export type DesktopPluginFieldDefinition = z.infer<
  typeof desktopPluginFieldDefinitionSchema
>;

export const desktopPluginActionRiskLevelSchema = z.enum(["read", "write"]);
export type DesktopPluginActionRiskLevel = z.infer<
  typeof desktopPluginActionRiskLevelSchema
>;

export const desktopPluginActionDefinitionSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  riskLevel: desktopPluginActionRiskLevelSchema,
  fields: z.array(desktopPluginFieldDefinitionSchema),
  referencePath: z.string().min(1).optional(),
});

export type DesktopPluginActionDefinition = z.infer<
  typeof desktopPluginActionDefinitionSchema
>;

export const desktopPluginAuthSchema = z.object({
  fields: z.array(desktopPluginFieldDefinitionSchema),
});

export type DesktopPluginAuth = z.infer<typeof desktopPluginAuthSchema>;

export const desktopPluginDataSourceTypeSchema = z.string().trim().min(1);

export type DesktopPluginDataSourceType = z.infer<
  typeof desktopPluginDataSourceTypeSchema
>;

export const desktopPluginDataSourceSetupFieldControlSchema = z.enum([
  "text",
  "password",
  "multiline_list",
  "select",
]);

export type DesktopPluginDataSourceSetupFieldControl = z.infer<
  typeof desktopPluginDataSourceSetupFieldControlSchema
>;

export const desktopPluginDataSourceSetupFieldSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  placeholder: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  required: z.boolean().default(false),
  control: desktopPluginDataSourceSetupFieldControlSchema.default("text"),
  defaultValue: z.string().min(1).optional(),
  options: z
    .array(
      z.object({
        label: z.string().min(1),
        value: z.string().min(1),
      }),
    )
    .min(1)
    .optional(),
});

export type DesktopPluginDataSourceSetupField = z.infer<
  typeof desktopPluginDataSourceSetupFieldSchema
>;

export const desktopPluginDataSourceOauthSchema = z.object({
  envClientIdName: z.string().min(1).optional(),
  envClientSecretName: z.string().min(1).optional(),
  envRedirectUriName: z.string().min(1).optional(),
  defaultRedirectUri: z.string().min(1).optional(),
  scopes: z.array(z.string().min(1)).min(1).optional(),
  publicClient: z.boolean().optional(),
});

export type DesktopPluginDataSourceOauth = z.infer<
  typeof desktopPluginDataSourceOauthSchema
>;

// A plugin declares what kind of thing it is. Data sources are the first and
// only type today; more types can be added as the plugin system grows.
export const desktopPluginTypeSchema = z.enum(["data_source"]);

export type DesktopPluginType = z.infer<typeof desktopPluginTypeSchema>;

export const DEFAULT_DESKTOP_PLUGIN_TYPE: DesktopPluginType = "data_source";

/** Serializable plugin-owned persistence vocabulary. No provider IDs live here. */
export const desktopPluginPersistenceSchema = z
  .object({
    configVersion: z.number().int().positive(),
    configFields: z.array(desktopPluginFieldDefinitionSchema),
    destinationField: z.string().min(1),
    resources: z.array(
      z.object({
        type: z.string().min(1),
        stateVersion: z.number().int().positive(),
        readActionId: z.string().min(1),
      }),
    ),
    eventChannels: z.array(z.string().min(1)),
  })
  .superRefine((contract, context) => {
    const keys = contract.configFields.map((field) => field.key);
    if (
      keys.some((key) =>
        ["constructor", "prototype", "__proto__"].includes(key),
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "Configuration field keys cannot be reserved object keys.",
      });
    }
    if (new Set(keys).size !== keys.length) {
      context.addIssue({
        code: "custom",
        message: "Configuration field keys must be unique.",
      });
    }
    const destination = contract.configFields.find(
      (field) => field.key === contract.destinationField,
    );
    if (destination?.type !== "string" || !destination.required) {
      context.addIssue({
        code: "custom",
        message: "Destination must be a required string configuration field.",
      });
    }
    if (contract.configFields.some((field) => field.secret === true)) {
      context.addIssue({
        code: "custom",
        message:
          "Secrets belong in auth fields, never persisted configuration.",
      });
    }
    if (
      new Set(contract.resources.map((resource) => resource.type)).size !==
        contract.resources.length ||
      new Set(contract.eventChannels).size !== contract.eventChannels.length
    ) {
      context.addIssue({
        code: "custom",
        message: "Resource types and event channels must be unique.",
      });
    }
  });

export type DesktopPluginPersistence = z.infer<
  typeof desktopPluginPersistenceSchema
>;

export const desktopPluginDescriptorMetadataSchema = z.object({
  persistence: desktopPluginPersistenceSchema.optional(),
  dataSource: z
    .object({
      sourceType: desktopPluginDataSourceTypeSchema,
      setupFields: z.array(desktopPluginDataSourceSetupFieldSchema).default([]),
      oauth: desktopPluginDataSourceOauthSchema.optional(),
    })
    .optional(),
});

export type DesktopPluginDescriptorMetadata = z.infer<
  typeof desktopPluginDescriptorMetadataSchema
>;

export const desktopPluginDescriptorSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.string().min(1),
  description: z.string().min(1),
  type: desktopPluginTypeSchema.default(DEFAULT_DESKTOP_PLUGIN_TYPE),
  referenceRepositoryPath: z.string().min(1).optional(),
  metadata: desktopPluginDescriptorMetadataSchema.optional(),
  auth: desktopPluginAuthSchema,
  actions: z.array(desktopPluginActionDefinitionSchema),
});

export type DesktopPluginDescriptor = z.infer<
  typeof desktopPluginDescriptorSchema
>;

export const desktopPluginInstallFromArtifactRequestSchema = z.object({
  artifactBase64: z.string().min(1),
  installRoot: z.string().min(1).optional(),
});

export type DesktopPluginInstallFromArtifactRequest = z.infer<
  typeof desktopPluginInstallFromArtifactRequestSchema
>;

export const desktopPluginInstallFromArtifactResultSchema = z.object({
  pluginId: z.string().min(1),
  installedPath: z.string().min(1),
  extractedEntryPath: z.string().min(1),
  descriptor: desktopPluginDescriptorSchema,
});

export type DesktopPluginInstallFromArtifactResult = z.infer<
  typeof desktopPluginInstallFromArtifactResultSchema
>;

export const desktopPluginExecutionRequestSchema = z.object({
  connectionConfig: z
    .object({
      version: z.number().int().positive(),
      value: z.record(z.string(), z.unknown()),
    })
    .strict()
    .optional(),
  pluginId: z.string().min(1),
  actionId: z.string().min(1),
  auth: z.record(z.string(), z.unknown()).optional().default({}),
  input: z.record(z.string(), z.unknown()).optional().default({}),
});

export type DesktopPluginExecutionRequest = z.infer<
  typeof desktopPluginExecutionRequestSchema
>;

export const desktopPluginExecutionResultSchema = z.object({
  pluginId: z.string().min(1),
  actionId: z.string().min(1),
  ok: z.boolean(),
  status: z.number().int().nonnegative(),
  summary: z.string().min(1),
  data: z.unknown().optional(),
});

export type DesktopPluginExecutionResult = z.infer<
  typeof desktopPluginExecutionResultSchema
>;

export type DesktopPluginInstallResult = {
  pluginId: string;
  installedPath: string;
  extractedEntryPath: string;
};

export type DesktopPluginCodeHostContext = {
  pluginRoot: string;
  entryPath: string;
  localPluginDirectories: string[];
  reloadPlugins(): Promise<void>;
};

/**
 * Non-serializable execution metadata supplied by the desktop host while an
 * action is running. All fields are optional so plugins compiled against
 * earlier SDK versions remain compatible with hosts that do not provide an
 * operation context.
 */
export type DesktopPluginOperationContext = {
  /** Aborts when the parent runbook, agent, or host operation is cancelled. */
  signal?: AbortSignal;
  /** Absolute Unix timestamp in milliseconds at which the host will time out. */
  deadlineAt?: number;
  /** Correlates plugin-side diagnostics with the parent execution. */
  executionId?: string;
};

export type DesktopPluginCodeActionContext = {
  /** Host-validated non-secret configuration of the selected connection. */
  config?: Record<string, unknown>;
  pluginId: string;
  actionId: string;
  auth: Record<string, unknown>;
  input: Record<string, unknown>;
  host: DesktopPluginCodeHostContext;
  operation?: DesktopPluginOperationContext;
};

export type DesktopPluginCodeActionHandlerResult = {
  ok?: boolean;
  status: number;
  summary: string;
  data?: unknown;
};

export type DesktopPluginCodeActionHandler = (
  context: DesktopPluginCodeActionContext,
) =>
  | DesktopPluginCodeActionHandlerResult
  | Promise<DesktopPluginCodeActionHandlerResult>;

export const desktopPluginPersistedDataSourceSetupSchema = z.object({
  accessTokenRef: z.string().optional(),
  refreshTokenRef: z.string().optional(),
  expiresAt: z.string().nullable().optional(),
  grantedScopes: z.array(z.string()).optional(),
  configuration: z.record(z.string(), z.unknown()).default({}),
});

export type DesktopPluginPersistedDataSourceSetup = z.infer<
  typeof desktopPluginPersistedDataSourceSetupSchema
>;

export const desktopPluginDataSourceRecordSchema = z.object({
  id: z.string().optional(),
  sourceType: z.string().min(1),
  name: z.string().optional(),
  accessTokenRef: z.string().nullable().optional(),
  refreshTokenRef: z.string().nullable().optional(),
  expiresAt: z.string().nullable().optional(),
  grantedScopes: z.array(z.string()).optional(),
  configuration: z.record(z.string(), z.unknown()).default({}),
});

export type DesktopPluginDataSourceRecord = z.infer<
  typeof desktopPluginDataSourceRecordSchema
>;

export type DesktopPluginResolveDataSourceSetupContext = {
  pluginId: string;
  setupValues: Record<string, unknown>;
  host: DesktopPluginCodeHostContext;
};

export type DesktopPluginBuildDataSourceAuthContext = {
  pluginId: string;
  source: DesktopPluginDataSourceRecord;
  host: DesktopPluginCodeHostContext;
};

export type DesktopPluginBuildDataSourceProbeAuthContext = {
  pluginId: string;
  persistedSetup: DesktopPluginPersistedDataSourceSetup;
  host: DesktopPluginCodeHostContext;
};

export type DesktopPluginResolveDataSourceSetupHandler = (
  context: DesktopPluginResolveDataSourceSetupContext,
) =>
  | DesktopPluginPersistedDataSourceSetup
  | Promise<DesktopPluginPersistedDataSourceSetup>;

export type DesktopPluginBuildDataSourceAuthHandler = (
  context: DesktopPluginBuildDataSourceAuthContext,
) => Record<string, unknown> | Promise<Record<string, unknown>>;

export type DesktopPluginBuildDataSourceProbeAuthHandler = (
  context: DesktopPluginBuildDataSourceProbeAuthContext,
) => Record<string, unknown> | Promise<Record<string, unknown>>;

export const desktopCodePluginDataSourceSchema = z.object({
  resolveSetup: z
    .custom<DesktopPluginResolveDataSourceSetupHandler>(
      (value) => typeof value === "function",
      "resolveSetup must be a function.",
    )
    .optional(),
  buildAuth: z
    .custom<DesktopPluginBuildDataSourceAuthHandler>(
      (value) => typeof value === "function",
      "buildAuth must be a function.",
    )
    .optional(),
  buildProbeAuth: z
    .custom<DesktopPluginBuildDataSourceProbeAuthHandler>(
      (value) => typeof value === "function",
      "buildProbeAuth must be a function.",
    )
    .optional(),
  probeProjectIdentity: z.enum(["id", "slug"]).optional(),
});

export type DesktopCodePluginDataSource = z.infer<
  typeof desktopCodePluginDataSourceSchema
>;

export const desktopCodePluginActionSchema =
  desktopPluginActionDefinitionSchema.extend({
    execute: z.custom<DesktopPluginCodeActionHandler>(
      (value) => typeof value === "function",
      "execute must be a function.",
    ),
  });

export type DesktopCodePluginAction = z.infer<
  typeof desktopCodePluginActionSchema
>;

/** Pure validation/upgrades run inside the plugin runtime, without database access. */
export interface DesktopPluginPersistenceHandlers {
  validateConfig: (config: Record<string, unknown>) => Record<string, unknown>;
  upgradeConfig?: (input: {
    version: number;
    config: Record<string, unknown>;
  }) => {
    version: number;
    config: Record<string, unknown>;
  };
  validateResourceState: (input: {
    resourceType: string;
    version: number;
    state: unknown;
  }) => unknown;
}

export const desktopCodePluginPersistenceSchema = z.object({
  validateConfig: z.custom<DesktopPluginPersistenceHandlers["validateConfig"]>(
    (value) => typeof value === "function",
    "validateConfig must be a function.",
  ),
  upgradeConfig: z
    .custom<NonNullable<DesktopPluginPersistenceHandlers["upgradeConfig"]>>(
      (value) => typeof value === "function",
      "upgradeConfig must be a function.",
    )
    .optional(),
  validateResourceState: z.custom<
    DesktopPluginPersistenceHandlers["validateResourceState"]
  >(
    (value) => typeof value === "function",
    "validateResourceState must be a function.",
  ),
});

export const desktopCodePluginSchema = desktopPluginDescriptorSchema
  .omit({
    actions: true,
  })
  .extend({
    actions: z.array(desktopCodePluginActionSchema),
    dataSource: desktopCodePluginDataSourceSchema.optional(),
    persistence: desktopCodePluginPersistenceSchema.optional(),
  });

export type DesktopCodePlugin = z.infer<typeof desktopCodePluginSchema>;

export * from "./persistence.js";
