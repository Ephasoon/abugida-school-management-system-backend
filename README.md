\# Abugida School Management System (ASMS)



> A full-stack school management system designed to centralize academic, administrative, financial, and communication workflows for schools.



\*\*Abugida School Management System (ASMS)\*\* is a WithUnion product currently under active development. The system is being built to provide schools with a centralized platform for managing students, teachers, classes, attendance, examinations, grades, finance, timetables, documents, parents, and analytics.



> \*\*Development Status:\*\* 🚧 Active Development — approximately 55% complete  

> \*\*Version:\*\* 0.1.0  

> \*\*Backend:\*\* Node.js + Express + PostgreSQL



\---



\## 📌 Project Overview



ASMS is designed as a modular school management platform with a web-based frontend and RESTful backend API.



The backend provides:



\- Authentication and authorization

\- Student management

\- Teacher management

\- Parent management

\- Academic year management

\- Class and subject management

\- Attendance management

\- Examination and grading

\- Finance management

\- Timetable management

\- Document management

\- PDF generation

\- Analytics

\- Role-based access control



The project is being developed incrementally, with additional modules and improvements planned for future releases.



\---



\## 🎯 Project Goals



The primary goals of ASMS are to:



\- Reduce manual school administration

\- Centralize student and staff information

\- Improve academic record management

\- Simplify attendance and examination workflows

\- Provide role-based access to school information

\- Improve communication between schools, teachers, students, and parents

\- Provide useful administrative and academic analytics

\- Establish a scalable foundation for future school management features



\---



\## ✨ Current Features



\### Authentication



\- User authentication

\- JWT access tokens

\- Refresh token authentication

\- HTTP-only refresh token cookies

\- Password hashing using bcrypt

\- Role-based authorization

\- Protected API routes



\### User Roles



The current authentication system supports:



\- Admin

\- Teacher

\- Student

\- Parent



\### Academic Management



\- Academic year management

\- Class management

\- Subject management

\- Teacher-subject assignments

\- Teacher-class assignments



\### Student Management



\- Student profiles

\- Student records

\- Parent relationships

\- Student-related documents

\- Student status management



\### Teacher Management



\- Teacher profiles

\- Teacher numbers

\- Teacher assignments

\- Qualifications

\- Specializations

\- Teacher subjects

\- Teacher classes



\### Attendance



\- Attendance records

\- Attendance management

\- Attendance reporting



\### Examinations \& Grades



\- Examination schedules

\- Grade management

\- Academic performance records



\### Finance



\- Financial records

\- Finance-related management and reporting



\### Timetable



\- Class timetables

\- Teacher assignments

\- Schedule management



\### Documents \& PDF



\- Document management

\- PDF generation

\- Report-card generation

\- ID-card generation



\### Analytics



\- Administrative analytics

\- Academic analytics

\- Dashboard data



\---



\## 🏗️ Architecture



ASMS follows a modular backend architecture:



```text

Frontend

&#x20;  │

&#x20;  │ HTTP / REST API

&#x20;  ▼

Node.js + Express

&#x20;  │

&#x20;  ├── Routes

&#x20;  │

&#x20;  ├── Controllers

&#x20;  │

&#x20;  ├── Middleware

&#x20;  │

&#x20;  ├── Services

&#x20;  │

&#x20;  ├── Utilities

&#x20;  │

&#x20;  └── Database Layer

&#x20;  │

&#x20;  ▼

PostgreSQL

```

---

## ⚙️ Configuration

Copy `.env.example` to `.env` and fill in real values. Never commit `.env`.

| Variable | Purpose |
|---|---|
| `PORT` | API port (default `3000`) |
| `NODE_ENV` | `development` or `production` (in production the refresh cookie is `Secure`, so HTTPS is required) |
| `CORS_ORIGINS` | Comma-separated browser origins allowed to call the API, e.g. `https://app.myschool.et`. If unset, `http://localhost:5500`, `http://127.0.0.1:5500`, `http://localhost:5501` and `http://127.0.0.1:5501` are allowed. The `null` origin (pages opened from disk, `file://`) is always rejected. |
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` | PostgreSQL connection |
| `JWT_SECRET`, `JWT_REFRESH_SECRET` | Long random secrets, e.g. `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `JWT_REFRESH_EXPIRES_IN` | Refresh-token lifetime (default `7d`) |
| `SCHOOL_NAME`, `SCHOOL_CODE`, `ACADEMIC_YEAR` | Shown on generated PDFs |

**`JWT_EXPIRES_IN` is no longer used.** Access tokens are fixed at 15 minutes in code; the frontend refreshes them automatically with the HTTP-only refresh cookie. You can delete the variable from `.env`.

### Authentication behaviour

- Refresh tokens are stored as sessions (`refresh_tokens`, hashed). Logout revokes the current session; a password change or disabling an account revokes all of that user's sessions.
- Login is limited to 5 failed attempts per 15 minutes per IP + email.
- New teachers get a one-time temporary password (returned once in `data.temporary_password`) and must change it at first login. Until then every route except `POST /api/auth/change-password` returns `403` with `errors.code = "PASSWORD_CHANGE_REQUIRED"`.
- Teachers can create exams and enter grades only for class + subject pairs they are assigned to (`POST /api/teachers/:id/classes`). **Assign every teacher before they start entering grades.**

---

## 🗄️ Database Migrations

Migrations live in `src/db/migrations` and are applied in filename order by:

```bash
npm run migrate
```

`migrate.js` records applied files in `_migrations`, skips files that already ran, and runs each file in its own transaction (a failing file is rolled back and stops the run).

Phase 0 adds these migrations. Running `npm run migrate` applies them in this order:

| # | File | What it does |
|---|---|---|
| 009 | `009_auth_sessions.sql` | `users.must_change_password`, `refresh_tokens` table |
| 010 | `010_create_documents.sql` | `documents` table (`IF NOT EXISTS`: an existing hand-made table is kept) |
| 011 | `011_create_exam_schedules.sql` | `exam_schedules` (exam time, room, instructions) |
| 012 | `012_fee_category_values.sql` | Adds `library`, `sport`, `uniform`, `transport` to `fee_category` |
| 013 | `013_fix_seed_admin_password.sql` | Fixes the seed admin hash, **only if** it is still the original broken one |
| 014 | `014_number_sequences.sql` | `student_number_seq` / `teacher_number_seq`, started after the highest existing number |
| 015 | `015_grade_score_limits.sql` | Score may not exceed `max_score`; `max_score` must be positive |

Before running 015 on existing data, both of these should return `0` (otherwise the migration stops and asks you to fix the rows first):

```sql
SELECT COUNT(*) FROM grades g JOIN exams e ON e.id = g.exam_id WHERE g.score > e.max_score;
SELECT COUNT(*) FROM exams WHERE max_score <= 0;
```

On a fresh database the seed admin is `admin@asms.et` / `Admin@1234`, and the password must be changed at first login.

---

## 🧪 Test Database

Use a separate database for testing so production data is never touched.

1. Create it as a PostgreSQL superuser, owned by the application user (the owner can create the `uuid-ossp` extension that migration 001 needs):

   ```bash
   createdb -U postgres -O asms_user asms_test
   ```

2. Run the migrations against it by overriding `DB_NAME` for that command only (`.env` stays unchanged; `dotenv` never overrides a variable that is already set):

   ```bash
   # Git Bash / macOS / Linux
   DB_NAME=asms_test npm run migrate
   DB_NAME=asms_test PORT=3100 npm start
   ```

   ```powershell
   # PowerShell
   $env:DB_NAME = 'asms_test'; npm run migrate
   $env:PORT = '3100'; npm start
   Remove-Item Env:DB_NAME, Env:PORT   # back to the .env values
   ```

3. Check you are on the test database before testing: `npm run migrate` prints `Database : asms_test`, and in development the server logs `Connected to PostgreSQL database: asms_test` on its first query.

---

## 🚀 Upgrading an Existing Installation (Phase 0)

1. Run `npm install` (adds `express-rate-limit`).
2. Run `npm run migrate` (applies 009–015).
3. Rotate `JWT_SECRET` and `JWT_REFRESH_SECRET`. Tokens issued under the old 100-day setting stay valid until the secret changes. Everyone logs in again.
4. Remove `JWT_EXPIRES_IN` and set `CORS_ORIGINS` in `.env`.
5. Assign every teacher to their classes and subjects (frontend: **Teachers → Class Assignments**).
