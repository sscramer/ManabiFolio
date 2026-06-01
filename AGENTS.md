# AGENTS.md

Purpose: guidance for agentic coding in this repo (GAS + HTML).

## Project Snapshot
- Platform: Google Apps Script (V8 runtime) with Google Sheets as the DB.
- Backend entry: `Code.gs` (doGet, debug loadtest handlers).
- Frontend: `index.html` (SPA with inline CSS/JS).
- Config: `appsscript.json` (timezone, runtime, OAuth scopes).
- Tests: `Tests.gs` (GAS functions), `tools/load_test.py` (Python load test).

## Build / Lint / Test Commands
This repo does not use npm/pyproject/make CI tooling. GAS runs directly.

### GAS editor (manual)
- Initialize sheets: run `setupSheets()` in `UserManagement.gs`.
- Run all tests: run `runAllTests()` in `Tests.gs`.
- Run a single test: run any of these in `Tests.gs`:
  - `testCacheService()`
  - `testQueueWrite()`
  - `testReadingRecordQueue()`
  - `testQueueProcessing()`
  - `testFormConfigCache()`
- Load tests (GAS): `runLoadTest()` or `runQuickLoadTest()` in `Tests.gs`.

### Python load test (CLI)
Prereq: `pip install requests`
```
python3 tools/load_test.py --debug
python3 tools/load_test.py -n 10 -w 5
python3 tools/load_test.py -n 10 -w 5 --baseline
python3 tools/load_test.py -n 10 -w 5 --mode write
python3 tools/load_test.py -n 10 -w 5 --mode write --type reading
python3 tools/load_test.py --url "<WEB_APP_URL>"
```

### Lint/format
- No repo-local lint/format config.
- If adding tooling, consider `@google/aside` (ESLint/Prettier/Jest) or ESLint + Prettier.

## Deployment Notes
- GAS deploy: Apps Script editor -> Deploy -> New deployment -> Web app.
- Execute as: Me. Access: Anyone with Google account (or domain).
- After code edits, create a new version before sharing the URL.

## Config / Secrets
- Script properties (set in GAS project settings):
  - Required: `SPREADSHEET_ID`, `TEACHER_DOMAIN`, `STUDENT_DOMAIN`
  - Optional: `GEMINI_API_KEY`, `DB_RESET_KEY`, `BACKUP_FOLDER_ID`, `DEBUG_ENTRY`
- Do not hardcode secrets in code or HTML.

## Code Style (Observed Conventions)
### General JS / GAS
- Functions: camelCase verbs (get, set, add, update, delete, create, toggle).
- Constants: UPPER_SNAKE_CASE (e.g., `BATCH_SIZE`, `QUEUE_LOCK_TIMEOUT_MS`).
- Variables: `const`/`let` with camelCase; avoid `var`.
- Return types: many API functions return `JSON.stringify(...)`.
- Errors: throw `new Error("...")` for permission or missing data.
- Logging: `console.log()` for info, `console.error()` for errors.

### Data access patterns
- Sheet lookup: `ss.getSheetByName('SheetName')`.
- Create sheet if missing: `ss.insertSheet('SheetName')`.
- Read: `getDataRange().getValues()`; skip headers when present.
- Write: `appendRow(...)` or batch `setValues(...)`.
- Use `LockService.getScriptLock()` for concurrent writes.

### Cache / Queue patterns
- Cache: `CacheService.getScriptCache()` with TTL (e.g., 600 seconds).
- Queue processing: `processAllQueues()` expected to run on a time trigger.
- Sharded queues: ResponseQueue_0..9, ReadingRecordQueue_0..9.

### Frontend (index.html)
- Single-page UI with inline CSS/JS.
- CSS variables defined in `:root` for theme.
- IDs/classes: kebab-case (e.g., `student-session-select`, `nav-btn`).
- UI state via class toggles (e.g., `.active`), and DOM updates.
- Uses `google.script.run` with success/failure handlers.

## Error Handling Guidance
- Enforce permission checks early (teacher vs student) in API functions.
- Use try/catch for spreadsheet operations and external requests.
- Always release locks in `finally` blocks.
- Return structured error objects for API calls; avoid empty catch blocks.

## Testing Guidance
- Prefer `runAllTests()` after significant backend changes.
- For single-feature changes, run only relevant test functions.
- For performance regressions, use `tools/load_test.py` against deployed app.
- DEBUG endpoints are gated by `DEBUG_ENTRY` script property.

## Design Constraints / Safety
- Keep changes minimal; avoid refactors in bugfixes.
- Do not add new dependencies unless asked.
- Avoid destructive spreadsheet operations unless explicitly requested.

## Docs / References
- Project overview: `README.md`.
- Shard queue details: `docs/shard_queue_implementation.md`.
- System docs: `.agent/system_documentation.html` and `.agent/system_overview.html`.

## Cursor / Copilot Rules
- No `.cursor/rules`, `.cursorrules`, or `.github/copilot-instructions.md` found.

## Quick Checklist (Before Final Answer)
- Did you run relevant GAS tests?
- Did you avoid changing spreadsheet data or triggers unintentionally?
- Did you keep inline HTML/JS/CSS style consistent with existing patterns?
- Did you avoid secrets and keep script properties in settings?
