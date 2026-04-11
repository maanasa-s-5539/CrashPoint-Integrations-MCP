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
        "CRASH_VERSIONS": "",
        "ZOHO_BUG_APP_VERSION": "",
        "ZOHO_BUG_NUM_OF_OCCURRENCES": ""
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
| `CRASH_VERSIONS` | App version value to set on Zoho Projects bugs (used with `ZOHO_BUG_APP_VERSION`) |
| `ZOHO_BUG_APP_VERSION` | Custom field name for app version on Zoho Projects bugs (e.g. `single_line`). If omitted, the app version field won't be set. |
| `ZOHO_BUG_NUM_OF_OCCURRENCES` | Custom field name for number of occurrences on Zoho Projects bugs (e.g. `number_of_occurrences`). If omitted, the occurrences field won't be set. |

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

## Automated Daily Pipeline

The `automation/` folder contains everything needed to schedule the full CrashPoint daily crash pipeline as an automated job using **Claude CLI** and **macOS launchd**.

The pipeline executes these steps every day:

1. **Download crashes from Apptics** — using your Apptics MCP server
2. **Export, symbolicate & analyze** — using CrashPoint-IOS-MCP
3. **Notify Cliq** — sends a crash summary to your Zoho Cliq channel
4. **Create / update bugs in Zoho Projects** — creates new issues for new crash signatures, increments occurrence counts on existing ones

### Prerequisites

- **Claude CLI** installed and accessible (e.g. `~/.local/bin/claude`)
- **Apptics MCP** connected via Claude Desktop (`claude mcp list` should show it)
- **Zoho Projects MCP** connected via Claude Desktop (`claude mcp list` should show it)
- ParentHolderFolder already set up with a valid `.env`

### Setup

> The `automation/` folder is created automatically in your ParentHolderFolder by the `setup_folders` tool in [CrashPoint-IOS-MCP](https://github.com/maanasa-s-5539/CrashPoint-IOS-MCP).

**1. Configure `.env` and `.mcp.json`**

Configure your `.env` with the automation variables (see `.env.example` for all variables). Create `.mcp.json` in your ParentHolderFolder root from the template and fill in your paths:

```bash
cp automation/.mcp.json.example .mcp.json
```

Open `.mcp.json` and fill in all `<REPLACE_*>` placeholders with your actual paths.

> The `--allowedTools` flag is built automatically from the `APPTICS_MCP_NAME` and `PROJECTS_MCP_NAME` values in your `.env`:
> `mcp__crashpoint-ios__*,mcp__crashpoint-integrations__*,mcp__claude_ai_<APPTICS_MCP_NAME>__*,mcp__claude_ai_<PROJECTS_MCP_NAME>__*`

**2. Edit `run_crash_pipeline.sh` — replace the two placeholders**

Open `automation/run_crash_pipeline.sh` and set:

| Placeholder | Replace with |
|---|---|
| `<REPLACE_WITH_PATH_TO_PARENT_HOLDER_FOLDER>` | Absolute path to your ParentHolderFolder |
| `<REPLACE_WITH_CLAUDE_CLI_PATH>` | Absolute path to the Claude CLI binary |

**3. (Optional) Configure the crash date offset**

The pipeline targets a specific past date rather than "the previous 24 hours", because:
- Apptics typically needs 1–2 days to ingest crash reports.
- Xcode Organizer can take up to 3 days for Apple to process and deliver `.xccrashpoint` crash logs.

By default the pipeline targets **3 days ago** (safe for both Apptics and Xcode Organizer). If today is April 11, the pipeline targets April 8.

To override the offset, add `CRASH_DATE_OFFSET` to your `crashpoint.config.json`:

```json
{
  "CRASH_DATE_OFFSET": "3"
}
```

| Value | Meaning |
|---|---|
| `"3"` | Target 3 days ago (default — safe for Xcode Organizer) |
| `"2"` | Target 2 days ago (suitable if you rely primarily on Apptics) |
| `"1"` | Target yesterday |

**4. Install and load the launchd plist**

```bash
# Copy and edit the plist
cp automation/com.crashpipeline.daily.plist.example \
   ~/Library/LaunchAgents/com.crashpipeline.daily.plist
```

Open the plist and replace:
- `<REPLACE_WITH_PATH_TO>` — the path containing your `automation/` folder (so the full script path resolves correctly)
- `<REPLACE_WITH_HOME_DIR>` — your home directory (e.g. `/Users/yourname`)

Then load it:

```bash
launchctl load ~/Library/LaunchAgents/com.crashpipeline.daily.plist
```

### Test Manually

```bash
bash /path/to/ParentHolderFolder/automation/run_crash_pipeline.sh
```

### Trigger via launchd

```bash
launchctl start com.crashpipeline.daily
```

### Logs

Each run writes a timestamped log to:

```
automation/ScheduledRunLogs/pipeline_YYYY-MM-DD_HH-MM-SS.log
```

launchd stdout/stderr are captured in `/tmp/crashpipeline_stdout.log` and `/tmp/crashpipeline_stderr.log`.

---

## License

MIT