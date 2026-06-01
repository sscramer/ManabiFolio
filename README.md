# ManabiFolio

ManabiFolio is a Google Apps Script and Google Sheets based school portfolio system. It lets students record reflections, reading activity, study logs, and self-assessments while teachers manage forms, view class progress, export data, and optionally use Gemini for draft guidance text.

This repository is prepared for public OSS use. It does not include deployment IDs, spreadsheet IDs, API keys, real domains, real school names, or sample personal data.

## Features

- Student reflection forms with reusable question sets.
- Student history, reading goals, reading records, study logs, and IGP self-assessment records.
- Teacher dashboards for sessions, submissions, class exports, reading summaries, study summaries, interviews, and roster management.
- Google Sheets backed storage with Apps Script server-side APIs.
- Optional Gemini integration through `GEMINI_API_KEY`.
- Optional queue processing and spreadsheet backup triggers.
- Demo data tools using `@demo.manabifolio.local`.

## Architecture

| File | Purpose |
| --- | --- |
| `Code.gs` | Web app entry point and debug/load-test handlers |
| `Utils.gs` | Spreadsheet, user, and authorization helpers |
| `UserManagement.gs` | Sheet setup, school year, and user profile management |
| `StudentAPI.gs` | Student portfolio, study log, and IGP APIs |
| `TeacherAPI.gs` | Teacher dashboard and export APIs |
| `ReadingAPI.gs` | Reading goal/record/reflection APIs |
| `ClassDiaryAPI.gs` | Class diary related APIs |
| `InterviewAPI.gs` | Teacher-only interview record APIs |
| `CommonAPI.gs` | Reusable question set APIs |
| `GeminiAPI.gs` | Optional AI guidance generation |
| `BatchProcessor.gs` | Queue, cleanup, and backup jobs |
| `DemoData.gs` | Teacher-only demo data generation |
| `index.html` | Single-page frontend |
| `appsscript.json` | Apps Script manifest |

## Required Script Properties

Set these in Apps Script: Project Settings -> Script properties.

| Property | Description | Example |
| --- | --- | --- |
| `SPREADSHEET_ID` | Google Sheets database ID | `<your-spreadsheet-id>` |
| `TEACHER_DOMAIN` | Comma-separated teacher email domains | `@teacher.example.ed.jp` |
| `STUDENT_DOMAIN` | Comma-separated student email domains | `@student.example.ed.jp,@demo.manabifolio.local` |

If Apps Script cannot obtain `Session.getActiveUser().getEmail()`, access is denied. Users outside the configured domains are denied.

## Optional Script Properties

| Property | Description | Example |
| --- | --- | --- |
| `GEMINI_API_KEY` | Gemini API key for AI guidance drafts | `<your-gemini-api-key>` |
| `AI_SCHOOL_CONTEXT` | Prompt role/context used for AI guidance | `日本の学校の教員` |
| `DB_RESET_KEY` | Confirmation key for `resetAllData` | `<strong-reset-key>` |
| `BACKUP_FOLDER_ID` | Google Drive folder ID for backups | `<backup-folder-id>` |
| `DEBUG_ENTRY` | Enables debug/load-test endpoints only when `true` or `1` | `false` |
| `DEMO_EMAIL_DOMAIN` | Demo data email domain | `@demo.manabifolio.local` |
| `DEMO_GRADE` | Demo data grade | `1` |
| `DEMO_CLASS` | Demo data class | `1` |
| `DEMO_STUDENT_COUNT` | Demo student count | `40` |

## Documentation

- [Deployment Guide](docs/deployment_guide.md)
- [Demo Data Guide](docs/demo_data_guide.md)
- [Security Policy](SECURITY.md)
- [Privacy Notes](PRIVACY.md)
- [Shard Queue Details](docs/shard_queue_implementation.md)
- [Database Schema](docs/database_schema.md)

## Development And Testing

This project does not use npm, make, or a local CI runner. Apps Script runs the `.gs` files directly.

In the Apps Script editor:

- Initialize sheets: `setupSheets()`
- Run all GAS tests: `runAllTests()`
- Run selected tests from `Tests.gs` as needed.

Python load testing:

```bash
pip install requests
python3 tools/load_test.py --url "<WEB_APP_URL>" --debug
python3 tools/load_test.py --url "<WEB_APP_URL>" -n 10 -w 5
```

Keep `DEBUG_ENTRY` disabled in production.

## License

MIT. See [LICENSE](LICENSE).
