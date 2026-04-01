# CrashPoint-Integrations-MCP

An MCP server that provides **Zoho Cliq notifications** and **Zoho Projects bug-reporting** integrations for [CrashPoint](https://github.com/maanasa-s-5539/CrashPoint-IOS-MCP) crash analysis reports.

This server is a companion to [`@maanasa-s-5539/crashpoint-ios-mcp`](https://github.com/maanasa-s-5539/CrashPoint-IOS-MCP) and depends on it as a core package. It re-implements the Zoho integrations that were removed from that package in [PR #54](https://github.com/maanasa-s-5539/CrashPoint-IOS-MCP/pull/54).

---

## What This Server Does

| Tool | Description |
|------|-------------|
| `notify_cliq` | Reads an existing `report.json` from the ParentHolderFolder and sends a formatted crash summary card to a Zoho Cliq channel via incoming webhook. |
| `report_to_projects` | Creates or updates Zoho Projects bugs from crash groups. Detects duplicates by signature and increments occurrence counts on existing bugs. |
| `run_full_pipeline` | Runs the full CrashPoint pipeline (export → symbolicate → analyze) via CrashPoint-IOS-MCP core functions, with optional Cliq notification and/or Zoho Projects issue creation at the end. |

---

## Prerequisites

1. **Node.js 18+**
2. **CrashPoint-IOS-MCP** must be installed and its `CRASH_ANALYSIS_PARENT` directory set up with your `.xccrashpoint` packages and dSYMs. See its [README](https://github.com/maanasa-s-5539/CrashPoint-IOS-MCP) for setup.
3. A **Zoho Cliq** channel with an incoming webhook URL (for `notify_cliq`).
4. A running **Zoho Projects MCP server** (for `report_to_projects`).

---

## Installation

```bash
npm install @maanasa-s-5539/crashpoint-integrations-mcp
```

### Build from source

```bash
git clone https://github.com/maanasa-s-5539/CrashPoint-Integrations-MCP.git
cd CrashPoint-Integrations-MCP
npm install
npm run build
```

---

## Configuration

Copy `.env.example` to `.env` and fill in the values:

```bash
cp .env.example .env
```

### MCP Config JSON (Claude / VS Code)

Add this server to your MCP client config:

```json
{
  "mcpServers": {
    "crashpoint-integrations": {
      "command": "npx",
      "args": ["-p", "github:maanasa-s-5539/CrashPoint-Integrations-MCP", "crashpoint-integrations"],
      "env": {
        "CRASH_ANALYSIS_PARENT": "/path/to/ParentHolderFolder",
        "ZOHO_CLIQ_WEBHOOK_URL": "https://cliq.zoho.in/company/{org_id}/api/v2/channelsbyname/{channel}/message",
        "ZOHO_PROJECTS_MCP_URL": "http://localhost:3000",
        "ZOHO_PROJECTS_PORTAL_ID": "your-portal-id",
        "ZOHO_PROJECTS_PROJECT_ID": "your-project-id",
        "ZOHO_BUG_STATUS_OPEN": "your-status-id",
        "ZOHO_BUG_SEVERITY_SHOWSTOPPER": "",
        "ZOHO_BUG_SEVERITY_CRITICAL": "",
        "ZOHO_BUG_SEVERITY_MAJOR": "",
        "ZOHO_BUG_SEVERITY_MINOR": "",
        "ZOHO_BUG_SEVERITY_NONE": "",
        "CRASH_VERSIONS": ""
      }
    }
  }
}
```

---

## Environment Variables

| Variable | Description |
|----------|-------------|
| `CRASH_ANALYSIS_PARENT` | Path to the ParentHolderFolder (shared with CrashPoint-IOS-MCP) |
| `ZOHO_CLIQ_WEBHOOK_URL` | Zoho Cliq channel incoming webhook URL |
| `ZOHO_PROJECTS_MCP_URL` | URL of the Zoho Projects MCP server |
| `ZOHO_PROJECTS_PORTAL_ID` | Zoho Projects portal ID |
| `ZOHO_PROJECTS_PROJECT_ID` | Zoho Projects project ID |
| `ZOHO_BUG_STATUS_OPEN` | Zoho bug status field ID for "Open" |
| `ZOHO_BUG_STATUS_FIXED` | Zoho bug status field ID for "Fixed" |
| `ZOHO_BUG_SEVERITY_SHOWSTOPPER` | Severity field ID: Showstopper (≥50 occurrences) |
| `ZOHO_BUG_SEVERITY_CRITICAL` | Severity field ID: Critical (≥20 occurrences) |
| `ZOHO_BUG_SEVERITY_MAJOR` | Severity field ID: Major (≥5 occurrences) |
| `ZOHO_BUG_SEVERITY_MINOR` | Severity field ID: Minor (≥2 occurrences) |
| `ZOHO_BUG_SEVERITY_NONE` | Severity field ID: None (1 occurrence) |
| `CRASH_VERSIONS` | Value for the `single_line` (app version) custom field on Zoho Projects bugs |

> **Note**: Zoho Projects numeric field value IDs are unique per portal/project. Discover them via the Zoho Projects API or UI.

---

## Available MCP Tools

### `notify_cliq`

Send a crash analysis report summary to Zoho Cliq.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `reportPath` | string | `<CRASH_ANALYSIS_PARENT>/report.json` | Path to the report.json file |
| `unfixedOnly` | boolean | `false` | Only include crash groups NOT marked as fixed |
| `dryRun` | boolean | `false` | Preview message without sending |

### `report_to_projects`

Create or update Zoho Projects bugs from crash groups.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `reportPath` | string | `<CRASH_ANALYSIS_PARENT>/report.json` | Path to the report.json file |
| `unfixedOnly` | boolean | `false` | Only report crash groups NOT marked as fixed |
| `dryRun` | boolean | `false` | Preview actions without making API calls |

**Severity mapping:**

| Occurrences | Severity |
|-------------|----------|
| ≥ 50 | Showstopper |
| ≥ 20 | Critical |
| ≥ 5 | Major |
| ≥ 2 | Minor |
| 1 | None |

### `run_full_pipeline`

Run the full CrashPoint pipeline end-to-end.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `notifyCliq` | boolean | `false` | Send Cliq notification after analysis |
| `reportToProjects` | boolean | `false` | Create/update Zoho Projects bugs after analysis |
| `unfixedOnly` | boolean | `false` | Only include unfixed groups in notifications |
| `versions` | string | — | Comma-separated version filter for crash export |
| `startDate` | string | — | ISO date string: only export crashes on or after this date |
| `endDate` | string | — | ISO date string: only export crashes on or before this date |
| `dryRun` | boolean | `false` | No side effects — dry-run for all stages |

---

## License

MIT