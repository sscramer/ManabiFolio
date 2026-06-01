# Portfolio Prototype Implementation Notes for AI Agents

This document describes the implementation details, architecture, and design decisions for the "ManabiFolio" portfolio prototype system. It is intended to help future AI agents understand the codebase.

## 1. Architecture Overview
- **Platform**: Google Apps Script (GAS)
- **Frontend**: HTML/JS styled with CSS, served via `HtmlService`. Single Page Application (SPA) architecture within `index.html`.
- **Backend**: GAS (`Code.gs`) interacting with Google Sheets as a database.
- **Communication**: `google.script.run` for asynchronous client-server communication.

## 2. Data Model (Google Sheets)
The system uses a single Spreadsheet with the following sheets:

### `Sessions`
Stores metadata for each questionnaire/portfolio session.
- **Columns**: `ID` | `Title` | `Description` | `Status` | `CreatedAt` | `RelatedSetTitle`
- **Key Concepts**:
    - `Status`: 'Active' (open), 'Closed' (read-only), 'Archived' (hidden from lists).
    - `RelatedSetTitle`: Links sessions created from the same "Common Question Set". Used for grouping in UI and aggregating annual data.

### `Questions`
Stores the actual questions for each session.
- **Columns**: `SessionID` | `QuestionID` | `Type` | `Label` | `Options` | `Min` | `Max` | `Order`
- **Note**: Questions are copied from Common Sets at creation time. This allows per-session customization but requires logic to link them back for analysis (see Matrix View).

### `Responses`
Stores student answers.
- **Columns**: `Timestamp` | `SessionID` | `Email` | `Answers_JSON`
- **Note**: 
    - `Answers_JSON` is a stringified JSON object `{ "question_id": "answer_value", ... }`.
    - Column order is strictly `[Timestamp, SessionID, Email, Answers_JSON]`. Be careful when parsing row arrays in GAS.

### `CommonQuestionSets`
Stores templates for reusable question sets (e.g., "Monthly Reflection").
- **Columns**: `SetID` | `SetTitle` | `QuestionID` | `Type` | `Label` | `Options` | `Min` | `Max` | `Order`
- **Structure**: Relational (one row per question).

## 3. Key Features & Implementation Logic

### Matrix View (Student Portfolio)
Displays a student's history for a specific series of sessions (e.g., April, May, June) side-by-side.
- **Logic**: Located in `index.html` (`renderStudentSession`).
- **Linking**: Sessions are linked if they share the same `RelatedSetTitle`.
- **Matching Questions**:
    1.  Primary: Matches questions by `QuestionID`.
    2.  Fallback: If IDs differ (e.g., set was recreated), matches by `Label` (question text).

### CSV Export
- **Teacher (Bulk)**: Exports all responses for all students across all sessions in a `RelatedSetTitle` series.
    - Implementation: `TeacherAPI.gs: getAnnualResponses`.
    - Matrix format: Rows = Email+Session, Columns = Questions.
- **Student (Personal)**: Exports only the requesting user's data for a series.
    - Implementation: `StudentAPI.gs: getMyAnnualResponses`.

### Session Management
- **Archiving**: "Delete" in the UI acts as a logical delete (`Status` = 'Archived'). They are hidden from dropdowns but persist in DB.
- **ID Generation**: `sess_yyyyMMdd_HHmmss` to avoid collisions.

### Data Reset
- **Admin Tool**: `resetAllData` in `UserManagement.gs` clears and recreates all sheets. Requires the `DB_RESET_KEY` script property or the default confirmation code.

### Concurrency Handling
- **Submission**: `LockService` is used in `submitForm` to queue concurrent writes (10s wait time).
- **Scale**: Designed for class-level usage (~40 students). 150+ simultaneous writes may hit GAS limits; staggered submission is recommended.

## 4. Client-Side (index.html)
- **State Management**: 
    - `configData`: Map of session metadata.
    - `userHistoryData`: Array of user's past responses.
    - `commonSetsData`: Loaded on demand for the editor.
- **Routing**: Simple `showView(viewId)` toggles visibility of divs (`student-view`, `teacher-dashboard`, etc.).
- **Impersonation**: `impersonatedEmail` allows testing as different users (Debug feature).

## 5. Potential Pitfalls / Future Work
- **Performance**: Fetching all responses might get slow as data grows. Pagination or range-based fetching is not implemented.
- **Question ID consistency**: If a Common Set is edited (question removed/added), the CSV headers are generated based on the *target session's* questions or a union of IDs. Column alignment relies on correct ID/Label mapping.
- **Security**: Server-side authorization is centralized in `Utils.gs`. Blank active-user email is denied, teacher/student roles come from script-property domains, and any `targetEmail` path must use the shared authorization helpers.

---
*Updated for the public ManabiFolio OSS release.*
