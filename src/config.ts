import fs from "fs";
import { z } from "zod";
import path from "path";

function readJsonIfExists(filePath: string): Record<string, unknown> | undefined {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as Record<string, unknown>;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      // File exists but could not be parsed — warn so misconfigured JSON is visible
      process.stderr.write(`[crashpoint-integrations] Warning: failed to read config at ${filePath}: ${err}\n`);
    }
    return undefined;
  }
}

function loadCrashpointConfigObject(): Record<string, unknown> {
  // 1. Explicit override via environment variable
  if (process.env.CRASHPOINT_CONFIG_PATH) {
    return readJsonIfExists(process.env.CRASHPOINT_CONFIG_PATH) ?? {};
  }
  // 2. Read from <CRASH_ANALYSIS_PARENT>/crashpoint.config.json
  if (process.env.CRASH_ANALYSIS_PARENT) {
    const cfgPath = path.join(process.env.CRASH_ANALYSIS_PARENT, "crashpoint.config.json");
    return readJsonIfExists(cfgPath) ?? {};
  }
  return {};
}

const envSchema = z.object({
  // Shared with CrashPoint-IOS-MCP
  CRASH_ANALYSIS_PARENT: z.string().min(1).describe("Path to ParentHolderFolder"),

  // Optional dSYM path for symbolication
  DSYM_PATH: z.string().optional().describe("Path to the .dSYM bundle for symbolication"),

  // Zoho Cliq
  ZOHO_CLIQ_WEBHOOK_URL: z.string().optional().describe("Zoho Cliq channel incoming webhook URL"),

  // Zoho Projects MCP
  ZOHO_PROJECTS_MCP_URL: z.string().optional().describe("URL of the Zoho Projects MCP server"),
  ZOHO_PROJECTS_PORTAL_ID: z.string().optional().describe("Zoho Projects portal ID"),
  ZOHO_PROJECTS_PROJECT_ID: z.string().optional().describe("Zoho Projects project ID"),

  // Bug status IDs
  ZOHO_BUG_STATUS_OPEN: z.string().optional().describe("Zoho bug status ID for Open"),
  ZOHO_BUG_STATUS_FIXED: z.string().optional().describe("Zoho bug status ID for Fixed"),

  // Bug severity IDs
  ZOHO_BUG_SEVERITY_SHOWSTOPPER: z.string().optional().describe("Severity ID: Showstopper"),
  ZOHO_BUG_SEVERITY_CRITICAL: z.string().optional().describe("Severity ID: Critical"),
  ZOHO_BUG_SEVERITY_MAJOR: z.string().optional().describe("Severity ID: Major"),
  ZOHO_BUG_SEVERITY_MINOR: z.string().optional().describe("Severity ID: Minor"),
  ZOHO_BUG_SEVERITY_NONE: z.string().optional().describe("Severity ID: None"),

  // Custom fields
  CRASH_VERSIONS: z.string().optional().describe("App version value to set on Zoho Projects bugs (used with ZOHO_BUG_APP_VERSION)"),
  ZOHO_BUG_APP_VERSION: z.string().optional().describe("Custom field name for app version on Zoho Projects bugs (e.g. 'custom_field_name_line'). If left empty, the app version custom field won't be set."),
  ZOHO_BUG_NUM_OF_OCCURRENCES: z.string().optional().describe("Custom field name for number of occurrences on Zoho Projects bugs (e.g. 'custom_field_number_of_occurrences'). If left empty, the occurrences custom field won't be set."),
});

export type IntegrationsConfig = z.infer<typeof envSchema>;

let cachedConfig: IntegrationsConfig | undefined;

export function getConfig(): IntegrationsConfig {
  if (!cachedConfig) {
    const fileCfg = loadCrashpointConfigObject();
    cachedConfig = envSchema.parse({ ...fileCfg, ...process.env });
  }
  return cachedConfig;
}

export function getSeverityId(config: IntegrationsConfig, count: number): string | undefined {
  if (count >= 50) return config.ZOHO_BUG_SEVERITY_SHOWSTOPPER;
  if (count >= 20) return config.ZOHO_BUG_SEVERITY_CRITICAL;
  if (count >= 5) return config.ZOHO_BUG_SEVERITY_MAJOR;
  if (count >= 2) return config.ZOHO_BUG_SEVERITY_MINOR;
  return config.ZOHO_BUG_SEVERITY_NONE;
}
