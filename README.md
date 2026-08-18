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

