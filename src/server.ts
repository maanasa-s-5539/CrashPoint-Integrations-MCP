import fs from "fs";
import path from "path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { z } from "zod";

import {
  getConfig as getCoreConfig,
  analyzeDirectory,
  filterUnfixedGroups,
  exportCrashLogs,
  runBatch,
  exportReportToCsv,
  loadFixStatuses,
  ProcessedManifest,
  getXcodeCrashesDir,
  getSymbolicatedDir,
  getAppticsCrashesDir,
  getOtherCrashesDir,
  hasCrashFiles,
} from "@maanasa-s-5539/crashpoint-ios-mcp";

import type { CrashReport, CrashGroup } from "@maanasa-s-5539/crashpoint-ios-mcp";

import { getConfig, getSeverityId } from "./config.js";

// ─── Server Setup ────────────────────────────────────────────────────────────

const server = new McpServer({
  name: "crashpoint-integrations",
  version: "1.0.0",
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function extractToolText(result: unknown, fallback: string): string {
  const r = result as { content?: Array<{ type: string; text?: string }> };
  const first = Array.isArray(r?.content) ? r.content[0] : undefined;
  return first?.type === "text" && first.text !== undefined ? first.text : fallback;
}

function findLatestReport(parentDir: string): string {
  const fallback = path.join(parentDir, "report.json");
  try {
    const files = fs
      .readdirSync(parentDir)
      .filter((f) => f.match(/^report_.*\.json$/))
      .map((f) => ({
        name: f,
        mtime: fs.statSync(path.join(parentDir, f)).mtimeMs,
      }))
      .sort((a, b) => b.mtime - a.mtime);
    if (files.length > 0) {
      return path.join(parentDir, files[0].name);
    }
  } catch {
    // fall through to default
  }
  return fallback;
}

function readReport(reportPath: string): CrashReport {
  const raw = fs.readFileSync(reportPath, "utf-8");
  return JSON.parse(raw) as CrashReport;
}

function buildBugTitle(group: CrashGroup): string {
  const sigSnippet = (group.signature ?? "unknown").slice(0, 30);
  return `[CrashPoint] ${group.exception_type} — ${sigSnippet}`;
}

function buildBugDescription(group: CrashGroup, occurrences: number): string {
  const devicesSummary = Object.entries(group.devices ?? {})
    .map(([k, v]) => `${k}(${v})`)
    .join(", ");
  const iosSummary = Object.entries(group.ios_versions ?? {})
    .map(([k, v]) => `${k}(${v})`)
    .join(", ");
  const appVSummary = Object.entries(group.app_versions ?? {})
    .map(([k, v]) => `${k}(${v})`)
    .join(", ");
  const sourcesSummary = Object.entries(group.sources ?? {})
    .map(([k, v]) => `${k}(${v})`)
    .join(", ");

  const lines: string[] = [
    `**Exception Type:** ${group.exception_type}`,
    `**Exception Codes:** ${group.exception_codes ?? "N/A"}`,
    `**Occurrences:** ${occurrences}`,
    "",
    "**Top Frames:**",
    ...(group.top_frames ?? []).map((f, i) => `  ${i}. ${f}`),
    "",
    `**Affected Devices:** ${devicesSummary || "N/A"}`,
    `**iOS Versions:** ${iosSummary || "N/A"}`,
    `**App Versions:** ${appVSummary || "N/A"}`,
    `**Sources:** ${sourcesSummary || "N/A"}`,
  ];

  if (group.crashed_thread) {
    lines.push("", `**Crashed Thread:** ${group.crashed_thread.display}`);
  }

  return lines.join("\n");
}

function buildCliqMessage(report: CrashReport, groups: CrashGroup[]): object {
  const date = report.report_date
    ? new Date(report.report_date).toLocaleDateString()
    : new Date().toLocaleDateString();

  const totalCrashes = groups.reduce((sum, g) => sum + (g.count ?? 0), 0);
  const uniqueTypes = new Set(groups.map((g) => g.exception_type)).size;

  const topGroups = groups.slice(0, 10);
  const groupLines = topGroups
    .map((g, i) => {
      const rank = i + 1;
      const fixed = g.fix_status?.fixed ? "✅ Fixed" : "🔴 Open";
      const topFrame = g.top_frames?.[0] ?? "unknown";
      return `${rank}. [${g.count}x] ${g.exception_type} @ ${topFrame} — ${fixed}`;
    })
    .join("\n");

  const text = [
    `🔴 *CrashPoint Report — ${date}*`,
    `Total crashes: ${totalCrashes} | Unique types: ${uniqueTypes}`,
    "",
    groupLines,
  ].join("\n");

  return {
    text,
    card: {
      title: `🔴 CrashPoint Report — ${date}`,
      theme: "modern-inline",
      thumbnail: "https://www.zohowebstatic.com/sites/zweb/images/cliq/cliq-og.png",
    },
  };
}

// ─── Tool: notify_cliq ───────────────────────────────────────────────────────

server.tool(
  "notify_cliq",
  "Send a crash analysis report summary to a Zoho Cliq channel via incoming webhook. Reads the existing report.json from the ParentHolderFolder.",
  {
    reportPath: z
      .string()
      .optional()
      .describe(
        "Path to the report.json file. Defaults to the latest report_*.json in CRASH_ANALYSIS_PARENT, or report.json."
      ),
    unfixedOnly: z
      .boolean()
      .optional()
      .describe("When true, only include crash groups that are NOT marked as fixed."),
    dryRun: z
      .boolean()
      .optional()
      .describe("When true, show the message that would be sent without actually posting to Cliq."),
  },
  async ({ reportPath, unfixedOnly, dryRun }) => {
    const cfg = getConfig();
    const resolvedPath = reportPath ?? findLatestReport(cfg.CRASH_ANALYSIS_PARENT);

    const rawReport = readReport(resolvedPath);
    let report = rawReport;

    if (unfixedOnly) {
      report = filterUnfixedGroups(rawReport).filtered;
    }

    const groups: CrashGroup[] = report.crash_groups ?? [];

    if (groups.length === 0) {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ success: true, message: "No crash groups to report." }),
          },
        ],
      };
    }

    const message = buildCliqMessage(report, groups);

    if (dryRun) {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              success: true,
              message: "Dry run — message not sent.",
              messagePreview: message,
            }),
          },
        ],
      };
    }

    if (!cfg.ZOHO_CLIQ_WEBHOOK_URL) {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              success: false,
              message: "ZOHO_CLIQ_WEBHOOK_URL is not configured.",
            }),
          },
        ],
      };
    }

    const response = await fetch(cfg.ZOHO_CLIQ_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message),
    });

    const cliqResponse = await response.text();

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            success: response.ok,
            message: response.ok
              ? `Cliq notification sent (HTTP ${response.status}).`
              : `Failed to send Cliq notification (HTTP ${response.status}).`,
            cliqResponse,
          }),
        },
      ],
    };
  }
);

// ─── Tool: report_to_projects ────────────────────────────────────────────────

server.tool(
  "report_to_projects",
  "Create or update Zoho Projects bugs from crash analysis reports. Detects duplicates by signature, increments occurrence count on existing bugs.",
  {
    reportPath: z
      .string()
      .optional()
      .describe(
        "Path to the report.json file. Defaults to the latest report_*.json in CRASH_ANALYSIS_PARENT, or report.json."
      ),
    unfixedOnly: z
      .boolean()
      .optional()
      .describe("When true, only report crash groups NOT marked as fixed."),
    dryRun: z
      .boolean()
      .optional()
      .describe("When true, show what would be created/updated without making API calls."),
  },
  async ({ reportPath, unfixedOnly, dryRun }) => {
    const cfg = getConfig();
    const resolvedPath = reportPath ?? findLatestReport(cfg.CRASH_ANALYSIS_PARENT);

    const rawReport = readReport(resolvedPath);
    let report = rawReport;

    if (unfixedOnly) {
      report = filterUnfixedGroups(rawReport).filtered;
    }

    const groups: CrashGroup[] = report.crash_groups ?? [];

    const results: Array<{
      signature: string;
      action: string;
      bugId?: string;
      error?: string;
    }> = [];
    let created = 0;
    let updated = 0;
    let skipped = 0;

    if (dryRun) {
      for (const group of groups) {
        const title = buildBugTitle(group);
        const severityId = getSeverityId(cfg, group.count ?? 1);
        results.push({
          signature: group.signature,
          action: `dry-run: would create bug "${title}" (severity: ${severityId ?? "unset"})`,
        });
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ created: 0, updated: 0, skipped: 0, details: results }),
          },
        ],
      };
    }

    if (!cfg.ZOHO_PROJECTS_MCP_URL) {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              created: 0,
              updated: 0,
              skipped: 0,
              details: [],
              error: "ZOHO_PROJECTS_MCP_URL is not configured.",
            }),
          },
        ],
      };
    }

    const zohoClient = new Client({ name: "crashpoint-integrations-client", version: "1.0.0" });
    const projectsTransport = new StreamableHTTPClientTransport(
      new URL(cfg.ZOHO_PROJECTS_MCP_URL)
    );

    try {
      await zohoClient.connect(projectsTransport);

      for (const group of groups) {
        const title = buildBugTitle(group);
        const signature = group.signature;

        try {
          // Search for existing bugs matching this exception type
          const listResult = await zohoClient.callTool({
            name: "list_bugs",
            arguments: {
              portal_id: cfg.ZOHO_PROJECTS_PORTAL_ID,
              project_id: cfg.ZOHO_PROJECTS_PROJECT_ID,
            },
          });

          const bugsRaw = extractToolText(listResult, "[]");
          const bugs: Array<{ id: string; title: string; description?: string }> = JSON.parse(
            bugsRaw
          );

          const existing = bugs.find((b) => b.title.includes(title.slice(0, 30)));

          if (existing) {
            // Parse existing occurrence count and increment
            const occMatch = existing.description?.match(/\*\*Occurrences:\*\*\s*(\d+)/);
            const prevCount = occMatch ? parseInt(occMatch[1], 10) : group.count ?? 1;
            const newCount = prevCount + (group.count ?? 1);
            const newDescription = buildBugDescription(group, newCount);

            await zohoClient.callTool({
              name: "update_bug",
              arguments: {
                portal_id: cfg.ZOHO_PROJECTS_PORTAL_ID,
                project_id: cfg.ZOHO_PROJECTS_PROJECT_ID,
                bug_id: existing.id,
                description: newDescription,
              },
            });

            results.push({ signature, action: "updated", bugId: existing.id });
            updated++;
          } else {
            const description = buildBugDescription(group, group.count ?? 1);
            const severityId = getSeverityId(cfg, group.count ?? 1);

            const createArgs: Record<string, string | undefined> = {
              portal_id: cfg.ZOHO_PROJECTS_PORTAL_ID,
              project_id: cfg.ZOHO_PROJECTS_PROJECT_ID,
              title,
              description,
            };
            if (cfg.ZOHO_BUG_STATUS_OPEN) createArgs.status_id = cfg.ZOHO_BUG_STATUS_OPEN;
            if (severityId) createArgs.severity_id = severityId;

            const createResult = await zohoClient.callTool({
              name: "create_bug",
              arguments: createArgs,
            });

            const createdRaw = extractToolText(createResult, "{}");
            const createdBug = JSON.parse(createdRaw) as { id?: string };

            results.push({ signature, action: "created", bugId: createdBug.id });
            created++;
          }
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          results.push({ signature, action: "error", error: errMsg });
          skipped++;
        }
      }
    } finally {
      await zohoClient.close();
    }

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ created, updated, skipped, details: results }),
        },
      ],
    };
  }
);

// ─── Tool: run_full_pipeline ─────────────────────────────────────────────────

server.tool(
  "run_full_pipeline",
  "Run the complete CrashPoint pipeline (export → symbolicate → analyze) with optional Zoho Cliq notification and/or Zoho Projects issue creation.",
  {
    notifyCliq: z
      .boolean()
      .optional()
      .describe("When true, send a notification to Zoho Cliq after analysis. Default false."),
    reportToProjects: z
      .boolean()
      .optional()
      .describe(
        "When true, create/update Zoho Projects bugs after analysis. Default false."
      ),
    unfixedOnly: z
      .boolean()
      .optional()
      .describe("When true, only include unfixed crash groups in notifications/reports."),
    versions: z
      .string()
      .optional()
      .describe("Comma-separated version filter for crash export."),
    startDate: z
      .string()
      .optional()
      .describe("ISO date string: only export crashes on or after this date."),
    endDate: z
      .string()
      .optional()
      .describe("ISO date string: only export crashes on or before this date."),
    csvOutputPath: z
      .string()
      .optional()
      .describe("Path to write CSV export of the report."),
    dryRun: z
      .boolean()
      .optional()
      .describe("When true, no side effects — dry-run for all stages."),
  },
  async ({
    notifyCliq,
    reportToProjects,
    unfixedOnly,
    versions,
    startDate,
    endDate,
    csvOutputPath,
    dryRun,
  }) => {
    const integrationsCfg = getConfig();
    // Validate core config is present (getCoreConfig() throws if CRASH_ANALYSIS_PARENT is missing)
    const coreConfig = getCoreConfig();
    const parentDir = integrationsCfg.CRASH_ANALYSIS_PARENT;
    const dsymPath = integrationsCfg.DSYM_PATH;
    // Write to a timestamped file so each pipeline run creates a distinct report
    const newReportPath = path.join(parentDir, `report_${Date.now()}.json`);

    const summary: Record<string, unknown> = {};

    // ── Step 1: Export ────────────────────────────────────────────────────────
    try {
      const manifest = new ProcessedManifest(parentDir);
      const versionList = versions ? versions.split(",").map((v) => v.trim()) : undefined;
      const exportOutputDir = getXcodeCrashesDir(coreConfig);
      const exportResult = exportCrashLogs(
        parentDir,       // inputDir: source directory containing .xccrashpoint packages
        exportOutputDir, // outputDir: destination for extracted crash logs
        versionList,     // versions filter
        false,           // force: do not re-export already-processed packages
        dryRun ?? false,
        startDate,
        endDate,
        manifest
      );
      summary.export = exportResult;
    } catch (err) {
      summary.export = { error: err instanceof Error ? err.message : String(err) };
    }

    // ── Step 2: Symbolicate ───────────────────────────────────────────────────
    const symbolicatedDir = getSymbolicatedDir(coreConfig);
    const xcodeCrashesDir = getXcodeCrashesDir(coreConfig);
    const appticsCrashesDir = getAppticsCrashesDir(coreConfig);
    const otherCrashesDir = getOtherCrashesDir(coreConfig);

    const symbolicateResults: unknown[] = [];

    if (dsymPath) {
      for (const srcDir of [xcodeCrashesDir, appticsCrashesDir, otherCrashesDir]) {
        try {
          if (fs.existsSync(srcDir) && hasCrashFiles(srcDir)) {
            const result = await runBatch(srcDir, dsymPath, symbolicatedDir, undefined);
            symbolicateResults.push({ dir: srcDir, result });
          }
        } catch (err) {
          symbolicateResults.push({
            dir: srcDir,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    } else {
      symbolicateResults.push({ skipped: true, reason: "DSYM_PATH not configured" });
    }
    summary.symbolicate = symbolicateResults;

    // ── Step 3: Analyze ───────────────────────────────────────────────────────
    let report: CrashReport | undefined;
    try {
      const fixStatuses = loadFixStatuses(parentDir);
      report = analyzeDirectory(symbolicatedDir, fixStatuses, undefined);

      if (!dryRun) {
        fs.writeFileSync(newReportPath, JSON.stringify(report, null, 2), "utf-8");
        summary.analyze = {
          crashGroups: report.crash_groups?.length ?? 0,
          reportPath: newReportPath,
        };

        if (csvOutputPath) {
          exportReportToCsv(report, csvOutputPath);
          summary.csv = { path: csvOutputPath };
        }
      } else {
        summary.analyze = { dryRun: true, crashGroups: report.crash_groups?.length ?? 0 };
      }
    } catch (err) {
      summary.analyze = { error: err instanceof Error ? err.message : String(err) };
    }

    // ── Step 4: Notify Cliq ───────────────────────────────────────────────────
    if (notifyCliq && report) {
      try {
        const cfg = getConfig();
        let filteredReport = report;
        if (unfixedOnly) {
          filteredReport = filterUnfixedGroups(report).filtered;
        }
        const groups: CrashGroup[] = filteredReport.crash_groups ?? [];

        if (groups.length === 0) {
          summary.cliq = { message: "No crash groups to notify." };
        } else if (dryRun) {
          const message = buildCliqMessage(filteredReport, groups);
          summary.cliq = { dryRun: true, preview: message };
        } else if (!cfg.ZOHO_CLIQ_WEBHOOK_URL) {
          summary.cliq = { error: "ZOHO_CLIQ_WEBHOOK_URL is not configured." };
        } else {
          const message = buildCliqMessage(filteredReport, groups);
          const response = await fetch(cfg.ZOHO_CLIQ_WEBHOOK_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(message),
          });
          summary.cliq = { success: response.ok, status: response.status };
        }
      } catch (err) {
        summary.cliq = { error: err instanceof Error ? err.message : String(err) };
      }
    }

    // ── Step 5: Report to Zoho Projects ───────────────────────────────────────
    if (reportToProjects && report) {
      try {
        const cfg = getConfig();
        let filteredReport = report;
        if (unfixedOnly) {
          filteredReport = filterUnfixedGroups(report).filtered;
        }
        const groups: CrashGroup[] = filteredReport.crash_groups ?? [];

        if (dryRun) {
          summary.projects = {
            dryRun: true,
            wouldProcess: groups.length,
            bugs: groups.map((g) => ({
              title: buildBugTitle(g),
              severity: getSeverityId(cfg, g.count ?? 1),
            })),
          };
        } else if (!cfg.ZOHO_PROJECTS_MCP_URL) {
          summary.projects = { error: "ZOHO_PROJECTS_MCP_URL is not configured." };
        } else {
          const zohoClient = new Client({
            name: "crashpoint-integrations-client",
            version: "1.0.0",
          });
          const projectsTransport = new StreamableHTTPClientTransport(
            new URL(cfg.ZOHO_PROJECTS_MCP_URL)
          );

          try {
            await zohoClient.connect(projectsTransport);

            let created = 0;
            let updated = 0;
            let skipped = 0;
            const details: Array<{
              signature: string;
              action: string;
              bugId?: string;
              error?: string;
            }> = [];

            for (const group of groups) {
              const title = buildBugTitle(group);
              const signature = group.signature;

              try {
                const listResult = await zohoClient.callTool({
                  name: "list_bugs",
                  arguments: {
                    portal_id: cfg.ZOHO_PROJECTS_PORTAL_ID,
                    project_id: cfg.ZOHO_PROJECTS_PROJECT_ID,
                  },
                });

                const bugsRaw = extractToolText(listResult, "[]");
                const bugs: Array<{
                  id: string;
                  title: string;
                  description?: string;
                }> = JSON.parse(bugsRaw);

                const existing = bugs.find((b) => b.title.includes(title.slice(0, 30)));

                if (existing) {
                  const occMatch = existing.description?.match(/\*\*Occurrences:\*\*\s*(\d+)/);
                  const prevCount = occMatch ? parseInt(occMatch[1], 10) : group.count ?? 1;
                  const newCount = prevCount + (group.count ?? 1);
                  const newDescription = buildBugDescription(group, newCount);

                  await zohoClient.callTool({
                    name: "update_bug",
                    arguments: {
                      portal_id: cfg.ZOHO_PROJECTS_PORTAL_ID,
                      project_id: cfg.ZOHO_PROJECTS_PROJECT_ID,
                      bug_id: existing.id,
                      description: newDescription,
                    },
                  });

                  details.push({ signature, action: "updated", bugId: existing.id });
                  updated++;
                } else {
                  const description = buildBugDescription(group, group.count ?? 1);
                  const severityId = getSeverityId(cfg, group.count ?? 1);

                  const createArgs: Record<string, string | undefined> = {
                    portal_id: cfg.ZOHO_PROJECTS_PORTAL_ID,
                    project_id: cfg.ZOHO_PROJECTS_PROJECT_ID,
                    title,
                    description,
                  };
                  if (cfg.ZOHO_BUG_STATUS_OPEN) createArgs.status_id = cfg.ZOHO_BUG_STATUS_OPEN;
                  if (severityId) createArgs.severity_id = severityId;

                  const createResult = await zohoClient.callTool({
                    name: "create_bug",
                    arguments: createArgs,
                  });

                  const createdRaw = extractToolText(createResult, "{}");
                  const createdBug = JSON.parse(createdRaw) as { id?: string };

                  details.push({ signature, action: "created", bugId: createdBug.id });
                  created++;
                }
              } catch (err) {
                const errMsg = err instanceof Error ? err.message : String(err);
                details.push({ signature, action: "error", error: errMsg });
                skipped++;
              }
            }

            summary.projects = { created, updated, skipped, details };
          } finally {
            await zohoClient.close();
          }
        }
      } catch (err) {
        summary.projects = { error: err instanceof Error ? err.message : String(err) };
      }
    }

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(summary, null, 2),
        },
      ],
    };
  }
);

// ─── Start Server ─────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
server.connect(transport).catch((err) => {
  console.error("Failed to start CrashPoint Integrations MCP server:", err);
  process.exit(1);
});
