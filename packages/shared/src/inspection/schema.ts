export interface InferredNode {
  types: string[];
  presence: number;
  samples: number;
  nullable: boolean;
  example: string | null;
  confidence: "low" | "medium" | "high";
  properties?: Record<string, InferredNode>;
  items?: InferredNode;
}

export interface InferredSchema {
  sampleCount: number;
  node: InferredNode | null;
  jsonSchema: Record<string, unknown> | null;
  note: string;
}

/** Merges observed JSON values. One observation never marks a field required. */
export function inferSchema(values: unknown[]): InferredSchema {
  const parsed = values.filter((value) => value !== undefined);
  if (parsed.length === 0) {
    return {
      sampleCount: 0,
      node: null,
      jsonSchema: null,
      note: "No JSON body was available to infer a schema.",
    };
  }
  const node = mergeValues(parsed);
  return {
    sampleCount: parsed.length,
    node,
    jsonSchema: toJsonSchema(node),
    note:
      parsed.length < 2
        ? "Inferred from a single observation. Fields are not treated as required."
        : "Required fields are those present in every sample, and only when at least three samples exist.",
  };
}

export function parseJsonBody(text: string | null): unknown | undefined {
  if (!text) {
    return undefined;
  }
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    return undefined;
  }
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return undefined;
  }
}

export function fieldTypes(value: unknown): Map<string, string> {
  const fields = new Map<string, string>();
  walkFields(value, "", fields);
  return fields;
}

export function diffFieldTypes(
  left: Map<string, string>,
  right: Map<string, string>,
): { added: string[]; removed: string[]; typeChanges: { path: string; from: string; to: string }[] } {
  const added: string[] = [];
  const removed: string[] = [];
  const typeChanges: { path: string; from: string; to: string }[] = [];
  for (const [path, type] of right) {
    if (!left.has(path)) {
      added.push(path);
    } else if (left.get(path) !== type) {
      typeChanges.push({ path, from: left.get(path) ?? "unknown", to: type });
    }
  }
  for (const path of left.keys()) {
    if (!right.has(path)) {
      removed.push(path);
    }
  }
  return { added, removed, typeChanges };
}

function mergeValues(values: unknown[]): InferredNode {
  const present = values.filter((value) => value !== undefined);
  const types = unique(present.map(jsonType));
  const objects = present.filter(isObject);
  const arrays = present.filter(Array.isArray);
  const example = exampleOf(present.find((value) => value !== null && !isObject(value) && !Array.isArray(value)) ?? present[0]);
  const node: InferredNode = {
    types,
    presence: 1,
    samples: present.length,
    nullable: present.some((value) => value === null),
    example,
    confidence: confidence(present.length),
  };
  if (objects.length > 0) {
    const keys = new Set<string>();
    for (const object of objects) {
      for (const key of Object.keys(object)) {
        keys.add(key);
      }
    }
    const properties: Record<string, InferredNode> = {};
    for (const key of keys) {
      const observed = objects.map((object) => (key in object ? object[key] : undefined));
      const defined = observed.filter((value) => value !== undefined);
      const child = mergeValues(defined);
      child.presence = roundRatio(defined.length / objects.length);
      child.samples = objects.length;
      properties[key] = child;
    }
    node.properties = properties;
  }
  if (arrays.length > 0) {
    const items = arrays.flatMap((array) => (array.length > 0 ? array.slice(0, 5) : [undefined])).filter((item) => item !== undefined);
    node.items = items.length > 0 ? mergeValues(items) : undefined;
  }
  return node;
}

function toJsonSchema(node: InferredNode): Record<string, unknown> {
  const schema: Record<string, unknown> = {};
  if (node.types.length === 1) {
    schema.type = node.nullable && node.types[0] !== "null" ? [node.types[0], "null"] : node.types[0];
  } else if (node.types.length > 1) {
    schema.type = node.nullable ? [...node.types, "null"] : node.types;
  }
  schema.description = describe(node);
  if (node.example !== null && node.example !== "[redacted]") {
    schema.examples = [node.example];
  }
  if (node.properties) {
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const [key, child] of Object.entries(node.properties)) {
      properties[key] = toJsonSchema(child);
      if (child.presence === 1 && child.samples >= 3) {
        required.push(key);
      }
    }
    schema.properties = properties;
    if (required.length > 0) {
      schema.required = required;
    }
  }
  if (node.items) {
    schema.items = toJsonSchema(node.items);
  }
  return schema;
}

function describe(node: InferredNode): string {
  const presence = node.presence === 1 ? "every sample" : `${Math.round(node.presence * 100)}% of samples`;
  const types = node.types.join(" | ") || "unknown";
  return `Observed as ${types} in ${presence}. Confidence: ${node.confidence}.`;
}

function walkFields(value: unknown, prefix: string, fields: Map<string, string>): void {
  if (Array.isArray(value)) {
    fields.set(prefix || "$", "array");
    if (value[0] !== undefined) {
      walkFields(value[0], prefix ? `${prefix}[]` : "[]", fields);
    }
    return;
  }
  if (isObject(value)) {
    if (prefix) {
      fields.set(prefix, "object");
    }
    for (const [key, nested] of Object.entries(value)) {
      walkFields(nested, prefix ? `${prefix}.${key}` : key, fields);
    }
    return;
  }
  if (prefix) {
    fields.set(prefix, jsonType(value));
  }
}

function jsonType(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return "array";
  }
  return typeof value;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exampleOf(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value === "string") {
    if (value === "[redacted]") {
      return "[redacted]";
    }
    return value.slice(0, 80);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return null;
}

function confidence(samples: number): "low" | "medium" | "high" {
  if (samples >= 5) {
    return "high";
  }
  if (samples >= 2) {
    return "medium";
  }
  return "low";
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function roundRatio(value: number): number {
  return Math.round(value * 1000) / 1000;
}
