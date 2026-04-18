export function loadConfig<T extends Record<string, string | undefined>>(
  schema: { [K in keyof T]: { envVar: string; required?: boolean; default?: string } },
): T {
  const config: Record<string, string | undefined> = {};

  for (const [key, def] of Object.entries(schema)) {
    const value = process.env[def.envVar] ?? def.default;
    if (def.required && !value) {
      throw new Error(`Missing required environment variable: ${def.envVar}`);
    }
    config[key] = value;
  }

  return config as T;
}
