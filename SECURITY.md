# Security Policy

## Supported Use

ManabiFolio is a self-hosted Google Apps Script web app. Each deploying school or organization is responsible for its own Google Workspace, spreadsheet, script properties, deployment access, and data governance.

## Reporting Vulnerabilities

This repository is intended for public OSS use. Do not open public issues containing student data, spreadsheet IDs, deployment URLs, domains, API keys, logs with personal data, or screenshots of real records.

Report vulnerabilities privately to the repository maintainers using the private reporting channel configured by the repository host. If no private channel is available, share only a minimal description and request a private contact path.

## Security Expectations

- Set `TEACHER_DOMAIN` and `STUDENT_DOMAIN` to organization-controlled domains only.
- Keep `DEBUG_ENTRY` unset or `false` in production.
- Store `SPREADSHEET_ID`, `GEMINI_API_KEY`, `DB_RESET_KEY`, and `BACKUP_FOLDER_ID` only in Apps Script script properties.
- Deploy the web app as "Execute as: Me" and restrict access to Google accounts or the organization domain.
- Treat the Google Sheet as the system database. Apply Drive sharing restrictions accordingly.
- Rotate credentials immediately if a deployment URL, spreadsheet ID, API key, or reset key is exposed.

## Authorization Model

Server-side authorization must not rely on hidden buttons, client-side state, or frontend role checks.

- Blank `Session.getActiveUser().getEmail()` is denied.
- Teacher access is determined by `TEACHER_DOMAIN`.
- Student access is determined by `STUDENT_DOMAIN`.
- Functions that accept a target student email must resolve it through shared authorization helpers.
- Students must not be able to pass another student's email to read, write, update, or delete that student's data.
- Multi-student records and administrative operations must be teacher-only.

## AI Data Handling

Gemini integration is optional. When enabled, selected student portfolio content may be sent to the configured external AI API. Review the provider's terms and your organization's policy before enabling `GEMINI_API_KEY`.
