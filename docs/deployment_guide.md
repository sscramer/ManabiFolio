# ManabiFolio Deployment Guide

This guide describes a clean deployment for a new Google Apps Script and Google Sheets installation.

## 1. Create The Database Sheet

1. Create a new Google Sheet.
2. Copy the spreadsheet ID from the URL.
3. Keep the Sheet private to administrators. The web app reads and writes through Apps Script.

## 2. Create The Apps Script Project

1. Open the Sheet.
2. Select Extensions -> Apps Script.
3. Add each `.gs` file and `index.html`.
4. Enable manifest editing and copy `appsscript.json`.

## 3. Configure Script Properties

Set the required properties:

| Property | Example |
| --- | --- |
| `SPREADSHEET_ID` | `<your-spreadsheet-id>` |
| `TEACHER_DOMAIN` | `@teacher.example.ed.jp` |
| `STUDENT_DOMAIN` | `@student.example.ed.jp,@demo.manabifolio.local` |

Recommended optional properties:

| Property | Example |
| --- | --- |
| `DB_RESET_KEY` | `<strong-reset-key>` |
| `BACKUP_FOLDER_ID` | `<backup-folder-id>` |
| `AI_SCHOOL_CONTEXT` | `日本の学校の教員` |

Only set `GEMINI_API_KEY` after privacy approval. Keep `DEBUG_ENTRY` unset or `false` outside test deployments.

## 4. Initialize Sheets

Run `setupSheets()` once from the Apps Script editor. Review the generated tabs before adding real users.

## 5. Deploy The Web App

Create a new web app deployment:

- Execute as: Me
- Access: Anyone with a Google account, or your organization/domain
- Description: `ManabiFolio v1`

After every code change, create a new deployment version before sharing the URL.

## 6. Add Time Triggers

Recommended queue processor:

- Function: `processAllQueues`
- Event source: Time-driven
- Type: Minute timer
- Interval: Every minute

Optional cleanup and backup:

- Run `setupNightlyCleanupTrigger()` as a teacher/admin.
- Run `setupDailyBackupTrigger()` as a teacher/admin.

## 7. Production Checklist

- `TEACHER_DOMAIN` and `STUDENT_DOMAIN` are set to the correct domains.
- `DEBUG_ENTRY` is absent or `false`.
- No demo data remains in production unless intentionally used.
- The Google Sheet is not publicly shared.
- The deployment URL is shared only through approved channels.
- `runAllTests()` has been run in the Apps Script editor after significant changes.
