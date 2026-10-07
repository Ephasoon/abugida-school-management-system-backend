// src/server.js — ASMS v1.5.0 — All 13 Modules
const express      = require('express');
const cors         = require('cors');
const helmet       = require('helmet');
const cookieParser = require('cookie-parser');
require('dotenv').config();

const authRoutes         = require('./routes/auth.routes');
const studentRoutes      = require('./routes/student.routes');
const attendanceRoutes   = require('./routes/attendance.routes');
const gradeRoutes        = require('./routes/grade.routes');
const financeRoutes      = require('./routes/finance.routes');
const teacherRoutes      = require('./routes/teacher.routes');
const timetableRoutes    = require('./routes/timetable.routes');
const pdfRoutes          = require('./routes/pdf.routes');
const parentRoutes       = require('./routes/parent.routes');
const academicYearRoutes = require('./routes/academicYear.routes');
const examScheduleRoutes = require('./routes/examSchedule.routes');
const analyticsRoutes    = require('./routes/analytics.routes');
const documentRoutes     = require('./routes/document.routes');
const accountRoutes      = require('./routes/accounts.routes');
const { sendServerError } = require('./utils/errors');

const app = express();
app.use(helmet());
// Allowed browser origins come from CORS_ORIGINS (comma-separated).
// The 'null' origin (file://, sandboxed iframes) is never allowed.
const DEFAULT_CORS_ORIGINS = 'http://localhost:5500,http://127.0.0.1:5500,http://localhost:5501,http://127.0.0.1:5501';
const corsOrigins = (process.env.CORS_ORIGINS || DEFAULT_CORS_ORIGINS)
  .split(',').map(o => o.trim()).filter(o => o && o !== 'null');
app.use(cors({
  origin: corsOrigins,
  credentials: true,
  // Lets the browser read the download filename (RFC 5987, e.g. Amharic names)
  exposedHeaders: ['Content-Disposition'],
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.get('/health', (req, res) => res.json({
  status:'OK', system:'ASMS', version:'1.5.0',
  modules:['auth','students','teachers','attendance','grades','finance',
           'timetable','pdf','parent','academic-years','exam-schedule',
           'analytics','documents'],
  time: new Date().toISOString(),
}));

app.use('/api/auth',           authRoutes);
app.use('/api/students',       studentRoutes);
app.use('/api/teachers',       teacherRoutes);
app.use('/api/attendance',     attendanceRoutes);
app.use('/api/grades',         gradeRoutes);
app.use('/api/finance',        financeRoutes);
app.use('/api/timetable',      timetableRoutes);
app.use('/api/pdf',            pdfRoutes);
app.use('/api/parent',         parentRoutes);
app.use('/api/academic-years', academicYearRoutes);
app.use('/api/exam-schedule',  examScheduleRoutes);
app.use('/api/analytics',      analyticsRoutes);
app.use('/api/documents',      documentRoutes);
app.use('/api/accounts',       accountRoutes);

app.use((req, res) => res.status(404).json({
  success:false, message:`Route not found: ${req.method} ${req.originalUrl}`
}));
app.use((err, req, res, next) => sendServerError(res, err, 'Internal server error.'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('\n🎓 ════════════════════════════════════════════');
  console.log('   Äbugida School Management System (ASMS)');
  console.log('   Version 1.5.0 — All 13 Modules Active');
  console.log('════════════════════════════════════════════\n');
  console.log(`🚀 Server           http://localhost:${PORT}`);
  console.log(`🔐 Auth             http://localhost:${PORT}/api/auth`);
  console.log(`👨‍🎓 Students         http://localhost:${PORT}/api/students`);
  console.log(`👩‍🏫 Teachers         http://localhost:${PORT}/api/teachers`);
  console.log(`📅 Attendance       http://localhost:${PORT}/api/attendance`);
  console.log(`📝 Grades           http://localhost:${PORT}/api/grades`);
  console.log(`💰 Finance          http://localhost:${PORT}/api/finance`);
  console.log(`🗓  Timetable        http://localhost:${PORT}/api/timetable`);
  console.log(`📄 PDF              http://localhost:${PORT}/api/pdf`);
  console.log(`👨‍👩‍👧 Parent           http://localhost:${PORT}/api/parent`);
  console.log(`🏫 Academic Years   http://localhost:${PORT}/api/academic-years`);
  console.log(`📋 Exam Schedule    http://localhost:${PORT}/api/exam-schedule`);
  console.log(`📊 Analytics        http://localhost:${PORT}/api/analytics`);
  console.log(`📁 Documents        http://localhost:${PORT}/api/documents`);
  console.log('\n📋 Environment:', process.env.NODE_ENV||'development');
  console.log('─'.repeat(46)+'\n');
});

module.exports = app;
