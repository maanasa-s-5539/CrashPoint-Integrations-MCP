You are running an automated daily crash analysis pipeline. Execute these steps in order, stopping if any step fails:

## Step 1: Download Crashes from Apptics
Use the {{APPTICS_MCP_NAME}} MCP server. Fetch all crashes and crash details for {{APP_DISPLAY_NAME}} iOS app, for the version number in the .env file from the previous 24 hours. Save the crash details to 'AppticsCrash_<number>.crash' text files, in AppticsCrashLogs.in 'AppticsCrashLogs/' directory.

## Step 2: Export Crash Logs
Use CrashPoint-IOS-MCP to run the full pipeline from the previous 24 hours.

## Step 3: Notify Cliq
Use the Crashpoint-integrations-mcp. Using the analyzed jsonReport_<timestamp> inside ParentHolderFolder -> AnalyzedReportsFolder , notify_cliq about all the crashes from the latest report.

## Step 4: Create/Update Bugs in Zoho Projects
Use the Crashpoint-integrations-mcp and {{PROJECTS_MCP_NAME}} MCPs and the latest report. Use the portal id, project id and field id values from the config file. Use these tools from {{PROJECTS_MCP_NAME}} MCP : getProjectsIssues, createProjectIssue, updateIssue.
If an issue with the same crash signature and app version number does not exist already, create a new issue, setting the App Version and Number of Occurrences field values.
If an issue with the same crash signature exists already, update the existing crash's number of occurrences. Take the existing value in the number of occurrences field, add the new number of occurrences to it and update the field.

After completing all steps, output a summary of what was processed.
