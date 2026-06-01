# Demo Data Guide

ManabiFolio includes teacher-only demo data helpers for local testing and screenshots.

## Defaults

Demo records use:

- Email domain: `@demo.manabifolio.local`
- Grade: `1`
- Class: `1`
- Student count: `40`

These are synthetic records and are not intended for production use.

## Optional Script Properties

You can override the defaults:

| Property | Example |
| --- | --- |
| `DEMO_EMAIL_DOMAIN` | `@demo.manabifolio.local` |
| `DEMO_GRADE` | `1` |
| `DEMO_CLASS` | `1` |
| `DEMO_STUDENT_COUNT` | `40` |

Include the demo domain in `STUDENT_DOMAIN` only for test deployments:

```text
@student.example.ed.jp,@demo.manabifolio.local
```

## Create Demo Data

1. Deploy or open the Apps Script editor as a teacher/admin account.
2. Confirm that the target spreadsheet is not production.
3. Run `createDummyData()`.

The helper creates demo user profiles, sample responses when form sessions exist, and sample reading records.

## Remove Demo Data

Run `deleteDummyData()` to remove rows containing the configured demo email domain from demo-supported sheets.

Before production use:

- Run `checkDummyDataExists()`.
- Confirm it returns `exists: false`.
- Keep `DEMO_EMAIL_DOMAIN` out of `STUDENT_DOMAIN` unless you intentionally need demo access.
