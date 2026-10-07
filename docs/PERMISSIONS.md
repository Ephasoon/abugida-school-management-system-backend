# ASMS Permission Rulebook

This is the source of truth for who may do what. Every API route must match it.

## Rules

| Feature | Admin | Principal | Teacher | Parent | Student |
|---|---|---|---|---|---|
| Dashboard | full school | full school | own classes | own children | own record |
| Students view | all | all | own classes | own children | self |
| Students register/edit | yes | view only | no | no | no |
| Teachers manage/assign | yes | view only | no | no | no |
| Attendance mark | yes | no | own classes | no | no |
| Attendance view | all | all | own classes | own children | self |
| Exams/grades enter | yes | no | own class+subject | no | no |
| Grades/report cards view | all | all | own classes | own children | self |
| Finance | full | view only | none | own children's fees | none |
| Documents | all | all | own uploads + public | none | none |
| Academic years/timetable setup | yes | view | own timetable | no | own timetable |
| User accounts/passwords | yes | own password | own password | own password | own password |

## Definitions

- **Own classes (teacher):** the classes listed for that teacher in `teacher_classes` (any subject). The homeroom teacher column (`classes.homeroom_teacher_id`) does not grant access.
- **Own class+subject (teacher):** a `teacher_classes` row for exactly that class *and* subject.
- **A student is in a teacher's own classes** when the student's current `students.class_id` is one of those classes.
- **Own children (parent):** students linked to the parent in `student_parents`.
- **Self (student):** the `students` row whose `user_id` is the logged-in user.
- **View only:** read endpoints are allowed; create, update and delete are not.
- **Own password:** every role may change its own password (`POST /api/auth/change-password`). Only admins create accounts or reset other users' passwords.

## Decisions for cases the table does not cover (2026-10-08)

| Topic | Decision |
|---|---|
| Teacher directory (`GET /teachers`, `/teachers/:id`) | Admin + principal see all teachers. A teacher sees **only their own** teacher record. |
| Parent timetable | Kept: a parent may view their own child's class timetable. "No" in the table means no setup rights. |
| Exam schedules (reads) | Same as grades view: admin + principal all; teacher own classes; parent own children's classes; student own class. Writes stay admin-only. |
| ID card PDFs | Admin only (student and teacher ID cards). |
| Principal and documents | View and download all documents (including private), and upload. Delete stays admin-only. |
| Parent fees | New all-children endpoint (balance per child plus a family total); the per-child endpoint stays. |
| Principal accounts | Admin creates them (email + display name, temporary password, forced change). |
| Parents per student | No limit. At most one parent per student can be the primary contact (already enforced by the database). |

---

## Audit of the current API (before Phase 1)

Legend: ✅ matches · ❌ mismatch · ➖ not covered by the table (needs a decision)

There is no `principal` role yet (`user_role` = admin, teacher, student, parent), so **every "Principal" cell is currently unmet**. That gap is not repeated row by row below.

### `/api/students`
| Route | Current access | Verdict |
|---|---|---|
| `GET /` | admin, teacher (all students) | ❌ teacher sees every student; should be own classes |
| `POST /`, `PUT /:id`, `DELETE /:id` | admin | ✅ |
| `GET /:id` | admin, teacher (any student) | ❌ teacher: any student; ❌ student cannot view own record; ❌ parent cannot view child's record here (only via `/api/parent`) |
| `GET /:id/summary` | admin, teacher (any), student (self), parent (children) | ❌ teacher: any student |

### `/api/teachers`
| Route | Current access | Verdict |
|---|---|---|
| `POST /`, `PUT /:id`, `POST /:id/subjects`, `POST /:id/classes`, `DELETE /:id/classes/...` | admin | ✅ |
| `GET /`, `GET /:id` | admin, teacher (all teachers, incl. email and phone) | ➖ teacher access to the teacher directory is not in the table |
| `GET /subjects` | admin, teacher | ✅ reference data |

### `/api/attendance`
| Route | Current access | Verdict |
|---|---|---|
| `POST /` (mark) | admin, teacher (any class) | ❌ teacher: any class, and students are not checked against the class |
| `PUT /:id` (correct) | admin | ✅ |
| `GET /student/:id` | admin, teacher (any), student (self), parent (children) | ❌ teacher: any student |
| `GET /report/:classId`, `GET /:classId/:date` | admin, teacher (any class) | ❌ teacher: any class |

### `/api/grades`
| Route | Current access | Verdict |
|---|---|---|
| `POST /exams`, `POST /` | admin; teacher (own class+subject only) | ✅ |
| `GET /exams` | admin, teacher (all exams) | ❌ teacher: all exams; should be own classes |
| `GET /report-card/:id` | admin, teacher (any), student (self), parent (children) | ❌ teacher: any student |

### `/api/pdf`
| Route | Current access | Verdict |
|---|---|---|
| `GET /report-card/:id` | admin, teacher (any), student (self), parent (children) | ❌ teacher: any student |
| `GET /student-id/:id` | admin, teacher (any student) | ➖ ID cards are not in the table |
| `GET /teacher-id/:id` | admin, teacher (any teacher) | ➖ not in the table (the route comment says "admin only", but the code allows teachers) |

### `/api/finance`
| Route | Current access | Verdict |
|---|---|---|
| all | admin | ✅ admin; ❌ principal view-only missing |

### `/api/parent`
| Route | Current access | Verdict |
|---|---|---|
| `GET /profile`, `/children`, `/child/:id/summary`, `/grades`, `/attendance`, `/fees` | parent (own children); admin allowed by the role check but always gets 403 (not a parent) | ✅ parent |
| `GET /child/:id/timetable` | parent (own children) | ➖ the table says parent "no" for timetable |

### `/api/academic-years`
| Route | Current access | Verdict |
|---|---|---|
| writes (`POST /`, `PUT /:id`, `/activate`, `/promote`) | admin | ✅ |
| reads (`GET /`, `/current`, `/:id/stats`) | admin | ❌ principal view missing |

### `/api/timetable`
| Route | Current access | Verdict |
|---|---|---|
| `POST /`, `PUT /:id`, `DELETE /:id` | admin | ✅ |
| `GET /classes`, `GET /subjects` | admin, teacher | ✅ reference data |
| `GET /class/:id` | admin, teacher (any class) | ❌ teacher: any class (table: own timetable); ❌ student cannot see own class timetable |
| `GET /teacher/:id` | admin, teacher (any teacher) | ❌ teacher: any teacher's timetable |

### `/api/exam-schedule`
| Route | Current access | Verdict |
|---|---|---|
| writes | admin | ✅ |
| reads (`/`, `/upcoming`, `/calendar`, `/class/:id`) | admin, teacher (all classes) | ➖ exam schedules are not in the table |

### `/api/documents`
| Route | Current access | Verdict |
|---|---|---|
| reads, upload | admin (all); teacher (own uploads + public) | ✅ |
| `DELETE /:id` | admin | ✅ |

### `/api/analytics`
| Route | Current access | Verdict |
|---|---|---|
| all | admin | ✅ admin; ❌ principal "full school" dashboard missing |

### Dashboards
| Role | Current | Verdict |
|---|---|---|
| Teacher | no teacher-specific endpoint; the admin dashboard data is not filtered | ❌ (Group D) |
| Parent | `/api/parent/children` + `/child/:id/summary` | ✅ |
| Student | `/api/students/:id/summary` (self) | ✅ |

### `/api/auth` and accounts
| Route | Current access | Verdict |
|---|---|---|
| `POST /change-password` | every role, own password | ✅ |
| Create accounts | teachers only (admin) | ❌ no student or parent account creation, no parent-student linking, no password reset (Group C) |
