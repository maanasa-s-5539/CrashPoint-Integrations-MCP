#!/bin/bash
set -euo pipefail

# ─── DERIVE PATHS FROM SCRIPT LOCATION ───────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# ─── LOGS ─────────────────────────────────────────────────────────────────────
LOG_DIR="$SCRIPT_DIR/ScheduledRunLogs"
mkdir -p "$LOG_DIR"

# ─── LOAD .env ────────────────────────────────────────────────────────────────
# Edit this path to point to your ParentHolderFolder
PARENT_HOLDER_FOLDER="<REPLACE_WITH_PATH_TO_PARENT_HOLDER_FOLDER>"
ENV_FILE="$PARENT_HOLDER_FOLDER/.env"

if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: .env file not found at $ENV_FILE"
  exit 1
fi

set -a
# shellcheck source=/dev/null
source "$ENV_FILE"
set +a

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

# ─── SUBSTITUTE PLACEHOLDERS FROM .env ───────────────────────────────────────
PROMPT=$(sed \
  -e "s|{{APP_DISPLAY_NAME}}|${APP_DISPLAY_NAME}|g" \
  -e "s|{{APPTICS_MCP_NAME}}|${APPTICS_MCP_NAME}|g" \
  -e "s|{{PROJECTS_MCP_NAME}}|${PROJECTS_MCP_NAME}|g" \
  -e "s|{{CRASH_VERSIONS}}|${CRASH_VERSIONS}|g" \
  "$PROMPT_FILE")

# ─── BUILD --allowedTools DYNAMICALLY FROM .env MCP NAMES ────────────────────
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
