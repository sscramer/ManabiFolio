# Privacy Notes

ManabiFolio stores school portfolio data in a Google Sheet controlled by the deploying organization. This repository does not ship with real student data, teacher data, school domains, spreadsheet IDs, deployment URLs, or API keys.

## Data Stored

Depending on enabled features, a deployment may store:

- User profile rows: school year, email, grade, class, number, display name, and registration timestamp.
- Form responses and reflection answers.
- Reading goals, reading records, and reading reflections.
- Study logs and IGP self-assessment records.
- Teacher-only interview records.
- Class diary records and related class configuration.

## Data Location

Data is stored in the Google Sheet identified by `SPREADSHEET_ID`. Optional backups are copied in Google Drive, optionally under `BACKUP_FOLDER_ID`.

## Access Control

Access is controlled by Google account identity and script properties:

- `TEACHER_DOMAIN` for teachers.
- `STUDENT_DOMAIN` for students.
- Blank active-user email is denied.

Teachers can access class and student data for operational use. Students are limited to their own portfolio records in server-side APIs.

## AI Processing

If `GEMINI_API_KEY` is configured, teachers may send selected student portfolio content to the Gemini API to generate draft guidance text. Do not enable this feature unless it is approved by the deploying organization's privacy policy.

## Demo Data

Demo data uses synthetic names and addresses under `@demo.manabifolio.local` by default. Do not mix demo data with production student records.

## Operator Responsibilities

Deploying organizations should:

- Limit Sheet and Script sharing to authorized administrators.
- Review OAuth scopes before deployment.
- Disable debug endpoints in production.
- Define data retention and deletion procedures.
- Avoid exporting or sharing files containing personal data outside approved systems.
