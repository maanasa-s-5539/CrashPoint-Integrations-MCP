#!/bin/bash
set -euo pipefail

# ─── DERIVE PATHS FROM SCRIPT LOCATION ───────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# ─── LOGS ─────────────────────────────────────────────────────────────────────
LOG_DIR="$SCRIPT_DIR/ScheduledRunLogs"
mkdir -p "$LOG_DIR"

# ─── LOAD CONFIG ──────────────────────────────────────────────────────────────
PARENT_HOLDER_FOLDER="<REPLACE_WITH_PATH_TO_PARENT_HOLDER_FOLDER>"
CONFIG_JSON="$PARENT_HOLDER_FOLDER/crashpoint.config.json"

if [ ! -f "$CONFIG_JSON" ]; then
  echo "ERROR: Config file not found at $CONFIG_JSON"
  exit 1
fi

# Validate that the config file contains valid JSON
if ! node -e "JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8'))" "$CONFIG_JSON" 2>/dev/null; then
  echo "ERROR: Config file at $CONFIG_JSON contains invalid JSON"
  exit 1
fi

# Read automation variables FROM config file
APP_DISPLAY_NAME=$(node -e "console.log(require(process.argv[1]).APP_DISPLAY_NAME || '')" "$CONFIG_JSON")
APPTICS_MCP_NAME=$(node -e "console.log(require(process.argv[1]).APPTICS_MCP_NAME || '')" "$CONFIG_JSON")
PROJECTS_MCP_NAME=$(node -e "console.log(require(process.argv[1]).PROJECTS_MCP_NAME || '')" "$CONFIG_JSON")
CRASH_VERSIONS=$(node -e "console.log(require(process.argv[1]).CRASH_VERSIONS || '')" "$CONFIG_JSON")

# ─── PRE-STEP: Clear latest report pointer copies only ───────────────────────
# Removes ONLY latest.json/latest.csv (the stable pointers/copies)
# Keeps all timestamped history (jsonReport_<ts>.json, sheetReport_<ts>.csv)
ANALYZED_DIR="$PARENT_HOLDER_FOLDER/AnalyzedReportsFolder"
LATEST_JSON="$ANALYZED_DIR/latest.json"
LATEST_CSV="$ANALYZED_DIR/latest.csv"

if [ -f "$LATEST_JSON" ]; then
  rm -f "$LATEST_JSON"
  echo "Cleared $LATEST_JSON"
fi
if [ -f "$LATEST_CSV" ]; then
  rm -f "$LATEST_CSV"
  echo "Cleared $LATEST_CSV"
fi

mkdir -p "$ANALYZED_DIR"

# ─── CLAUDE CLI PATH ──────────────────────────────────────────────────────────
# Edit this to the path of your Claude CLI binary
CLAUDE_PATH="<REPLACE_WITH_CLAUDE_CLI_PATH>"

# ─── PROMPT TEMPLATE ─────────────────────────────────────────────────────────
PROMPT_FILE="$SCRIPT_DIR/daily_crash_pipeline_prompt.md"

if [ ! -f "$PROMPT_FILE" ]; then
  echo "ERROR: Prompt template not found at $PROMPT_FILE"
  exit 1
fi

if [ ! -x "$CLAUDE_PATH" ]; then
  echo "ERROR: Claude CLI not found or not executable at $CLAUDE_PATH"
  exit 1
fi

# ─── SUBSTITUTE PLACEHOLDERS FROM config file ────────────────────────────────
PROMPT=$(sed \
  -e "s|{{APP_DISPLAY_NAME}}|${APP_DISPLAY_NAME}|g" \
  -e "s|{{APPTICS_MCP_NAME}}|${APPTICS_MCP_NAME}|g" \
  -e "s|{{PROJECTS_MCP_NAME}}|${PROJECTS_MCP_NAME}|g" \
  -e "s|{{CRASH_VERSIONS}}|${CRASH_VERSIONS}|g" \
  "$PROMPT_FILE")

# ─── BUILD --allowedTools DYNAMICALLY FROM config file ───────────────────────
ALLOWED_TOOLS="mcp__crashpoint-ios__*,mcp__crashpoint-integrations__*,mcp__claude_ai_${APPTICS_MCP_NAME}__*,mcp__claude_ai_${PROJECTS_MCP_NAME}__*"

# ─── TIMESTAMP & LOG FILE ─────────────────────────────────────────────────────
TIMESTAMP=$(date +"%Y-%m-%d_%H-%M-%S")
LOG_FILE="$LOG_DIR/pipeline_${TIMESTAMP}.log"

{
  echo "=== Crash Pipeline Run: $TIMESTAMP ==="
  echo "App:           ${APP_DISPLAY_NAME}"
  echo "Version:       ${CRASH_VERSIONS}"
  echo "Apptics MCP:   ${APPTICS_MCP_NAME}"
  echo "Projects MCP:  ${PROJECTS_MCP_NAME}"
  echo "Allowed Tools: ${ALLOWED_TOOLS}"
  echo "---"
} | tee "$LOG_FILE"

# ─── cd INTO ParentHolderFolder (so Claude picks up .mcp.json) ───────────────
cd "$PARENT_HOLDER_FOLDER"

# ─── RUN PIPELINE ─────────────────────────────────────────────────────────────
"$CLAUDE_PATH" -p "$PROMPT" \
  --allowedTools "$ALLOWED_TOOLS" \
  --max-turns 30 \
  2>&1 | tee -a "$LOG_FILE"

EXIT_CODE=${PIPESTATUS[0]}

if [ "$EXIT_CODE" -ne 0 ]; then
  echo "ERROR: Pipeline failed with exit code $EXIT_CODE" | tee -a "$LOG_FILE"
fi

echo "=== Pipeline Complete ===" | tee -a "$LOG_FILE"
exit "$EXIT_CODE"
