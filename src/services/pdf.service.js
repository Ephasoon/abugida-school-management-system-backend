// src/services/pdf.service.js
// ============================================================
// PDF Generation Service using PDFKit
// Generates:
//   1. Report Card PDF — professional A4 academic report
//   2. Student ID Card PDF — credit-card sized with QR code
//   3. Teacher ID Card PDF
// ============================================================

const PDFDocument = require('pdfkit');
const QRCode      = require('qrcode');

// ── Color Palette ─────────────────────────────────────────────
const COLORS = {
  primary:    '#1a1a2e',   // Dark navy
  gold:       '#F5A623',   // Gold accent
  gold_light: '#FDF3E3',   // Light gold background
  green:      '#27AE60',   // Pass / good grade
  red:        '#E74C3C',   // Fail / warning
  blue:       '#2980B9',   // Info
  gray:       '#95A5A6',   // Secondary text
  light_gray: '#F8F9FA',   // Row backgrounds
  white:      '#FFFFFF',
  border:     '#DEE2E6',
};

// ── Grade Letter Color ─────────────────────────────────────────
const gradeColor = (letter) => {
  if (!letter) return COLORS.gray;
  if (letter.startsWith('A')) return COLORS.green;
  if (letter.startsWith('B')) return COLORS.blue;
  if (letter.startsWith('C')) return COLORS.gold;
  return COLORS.red;
};

// ── Grade to GPA Points ───────────────────────────────────────
const gradePoints = (letter) => ({
  'A+':4.0,'A':4.0,'A-':3.7,
  'B+':3.3,'B':3.0,'B-':2.7,
  'C+':2.3,'C':2.0,'C-':1.7,
  'D':1.0,'F':0.0,
}[letter] || 0);


// ═══════════════════════════════════════════════════════════════
// 1. REPORT CARD PDF
// ═══════════════════════════════════════════════════════════════
const generateReportCard = async (data, res) => {
  const { student, subjects, academic_summary, attendance, school } = data;

  const doc = new PDFDocument({
    size:    'A4',
    margins: { top: 40, bottom: 40, left: 50, right: 50 },
  });

  // Pipe to response
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition',
    `attachment; filename="report-card-${student.student_number}.pdf"`);
  doc.pipe(res);

  const W    = doc.page.width;
  const H    = doc.page.height;
  const PL   = 50;  // Padding left
  const PR   = 50;  // Padding right
  const CW   = W - PL - PR; // Content width

  // ── Header Bar ───────────────────────────────────────────────
  doc.rect(0, 0, W, 100).fill(COLORS.primary);

  // Gold accent line
  doc.rect(0, 100, W, 5).fill(COLORS.gold);

  // School name
  doc.font('Helvetica-Bold').fontSize(18).fillColor(COLORS.white)
     .text(school?.name || 'Äbugida School', PL, 22, { width: CW * 0.7 });

  doc.font('Helvetica').fontSize(10).fillColor(COLORS.gold)
     .text('STUDENT REPORT CARD', PL, 46);

  doc.font('Helvetica').fontSize(9).fillColor(COLORS.gray)
     .text(school?.academic_year || '2024/2025', PL, 60)
     .text(`Generated: ${new Date().toLocaleDateString('en-ET')}`, PL, 73);

  // Ethiopian flag colors accent
  doc.rect(W - 120, 20, 15, 60).fill('#009A44'); // Green
  doc.rect(W - 105, 20, 15, 60).fill(COLORS.gold); // Yellow
  doc.rect(W - 90,  20, 15, 60).fill('#EF2118');  // Red

  // ── Student Info Section ─────────────────────────────────────
  let y = 125;

  doc.rect(PL, y, CW, 80).fill(COLORS.light_gray).stroke(COLORS.border);

  // Student avatar circle
  doc.circle(PL + 35, y + 40, 28).fill(COLORS.primary);
  doc.font('Helvetica-Bold').fontSize(18).fillColor(COLORS.white)
     .text(
       (student.first_name?.[0] || '') + (student.last_name?.[0] || ''),
       PL + 17, y + 29
     );

  // Student details
  const infoX = PL + 75;
  doc.font('Helvetica-Bold').fontSize(14).fillColor(COLORS.primary)
     .text(`${student.first_name} ${student.last_name}${student.fathers_name ? ' ' + student.fathers_name : ''}`,
       infoX, y + 12);

  doc.font('Helvetica').fontSize(10).fillColor(COLORS.gray)
     .text(`Student ID: ${student.student_number}`, infoX, y + 32)
     .text(`Class: ${student.class_name || 'N/A'}  |  Grade: ${student.grade_level || 'N/A'}  |  Section: ${student.section || 'N/A'}`,
       infoX, y + 46)
     .text(`Academic Year: ${student.academic_year || '2024/2025'}  |  Gender: ${student.gender || 'N/A'}`,
       infoX, y + 60);

  y += 100;

  // ── Academic Summary Bar ──────────────────────────────────────
  const summaryItems = [
    { label: 'GPA',        value: academic_summary?.gpa || '0.00',       color: COLORS.gold },
    { label: 'Rank',       value: academic_summary?.rank
        ? `${academic_summary.rank}/${academic_summary.total_in_class}` : 'N/A', color: COLORS.blue },
    { label: 'Attendance', value: `${attendance?.rate || 0}%`,            color: COLORS.green },
    { label: 'Result',     value: academic_summary?.result || 'N/A',
      color: academic_summary?.result === 'PASS' ? COLORS.green : COLORS.red },
  ];

  const boxW = CW / summaryItems.length;
  summaryItems.forEach((item, i) => {
    const x = PL + (i * boxW);
    doc.rect(x, y, boxW - 4, 60).fill(COLORS.primary);
    doc.font('Helvetica-Bold').fontSize(20).fillColor(item.color)
       .text(item.value, x, y + 10, { width: boxW - 4, align: 'center' });
    doc.font('Helvetica').fontSize(8).fillColor(COLORS.gray)
       .text(item.label, x, y + 40, { width: boxW - 4, align: 'center' });
  });

  y += 75;

  // ── Grades Table ──────────────────────────────────────────────
  doc.font('Helvetica-Bold').fontSize(12).fillColor(COLORS.primary)
     .text('ACADEMIC PERFORMANCE', PL, y);
  y += 18;

  // Table header
  const cols = { subject: PL, midterm: PL+200, final: PL+270, total: PL+340, grade: PL+410 };
  doc.rect(PL, y, CW, 22).fill(COLORS.primary);
  doc.font('Helvetica-Bold').fontSize(9).fillColor(COLORS.white);
  doc.text('Subject',         cols.subject + 5, y + 7, { width: 180 });
  doc.text('Midterm',         cols.midterm,      y + 7, { width: 65, align: 'center' });
  doc.text('Final',           cols.final,        y + 7, { width: 65, align: 'center' });
  doc.text('Average',         cols.total,        y + 7, { width: 65, align: 'center' });
  doc.text('Grade',           cols.grade,        y + 7, { width: 60, align: 'center' });
  y += 22;

  // Table rows
  (subjects || []).forEach((sub, idx) => {
    const rowColor = idx % 2 === 0 ? COLORS.white : COLORS.light_gray;
    doc.rect(PL, y, CW, 20).fill(rowColor);

    // Left border color by grade
    doc.rect(PL, y, 4, 20).fill(gradeColor(sub.grade_letter));

    doc.font('Helvetica').fontSize(9).fillColor(COLORS.primary);
    doc.text(sub.subject || sub.subject_name || '—', cols.subject + 8, y + 6, { width: 185 });

    // Find midterm and final scores
    const midterm = sub.exams?.find(e => e.exam_type === 'midterm');
    const final   = sub.exams?.find(e => e.exam_type === 'final');

    doc.fillColor(COLORS.gray);
    doc.text(midterm ? `${midterm.score}/${midterm.max_score}` : '—',
      cols.midterm, y + 6, { width: 65, align: 'center' });
    doc.text(final   ? `${final.score}/${final.max_score}`     : '—',
      cols.final,   y + 6, { width: 65, align: 'center' });

    doc.fillColor(COLORS.primary).font('Helvetica-Bold');
    doc.text(`${sub.average || '0'}%`, cols.total, y + 6, { width: 65, align: 'center' });

    // Grade badge
    doc.rect(cols.grade + 10, y + 3, 40, 14)
       .fill(gradeColor(sub.grade_letter));
    doc.fillColor(COLORS.white).font('Helvetica-Bold').fontSize(8)
       .text(sub.grade_letter || '—', cols.grade + 10, y + 6,
         { width: 40, align: 'center' });

    y += 20;

    // Stop if near bottom
    if (y > H - 120) {
      doc.addPage();
      y = 50;
    }
  });

  // Table bottom border
  doc.rect(PL, y, CW, 1).fill(COLORS.border);
  y += 15;

  // ── Attendance Summary ────────────────────────────────────────
  if (y < H - 120) {
    doc.font('Helvetica-Bold').fontSize(11).fillColor(COLORS.primary)
       .text('ATTENDANCE SUMMARY', PL, y);
    y += 15;

    const attItems = [
      { label: 'Total Days',  value: attendance?.total_days || 0 },
      { label: 'Present',     value: attendance?.present || 0 },
      { label: 'Absent',      value: attendance?.absent || 0 },
      { label: 'Late',        value: attendance?.late || 0 },
      { label: 'Rate',        value: `${attendance?.rate || 0}%` },
    ];

    attItems.forEach((item, i) => {
      const x = PL + (i * (CW / attItems.length));
      doc.rect(x, y, CW/attItems.length - 4, 40).fill(COLORS.light_gray);
      doc.font('Helvetica-Bold').fontSize(16).fillColor(COLORS.primary)
         .text(String(item.value), x, y + 6,
           { width: CW/attItems.length - 4, align: 'center' });
      doc.font('Helvetica').fontSize(8).fillColor(COLORS.gray)
         .text(item.label, x, y + 26,
           { width: CW/attItems.length - 4, align: 'center' });
    });

    y += 55;
  }

  // ── Remarks & Signature ───────────────────────────────────────
  if (y < H - 100) {
    doc.rect(PL, y, CW * 0.55, 60).stroke(COLORS.border);
    doc.font('Helvetica-Bold').fontSize(9).fillColor(COLORS.primary)
       .text('Teacher Remarks:', PL + 8, y + 8);
    doc.font('Helvetica').fontSize(9).fillColor(COLORS.gray)
       .text('_____________________________________________', PL + 8, y + 24)
       .text('_____________________________________________', PL + 8, y + 38);

    const sigX = PL + CW * 0.65;
    doc.font('Helvetica').fontSize(9).fillColor(COLORS.gray)
       .text('School Director Signature:', sigX, y + 8)
       .text('___________________________', sigX, y + 35)
       .text('Date: ____________________', sigX, y + 50);
  }

  // ── Footer ────────────────────────────────────────────────────
  doc.rect(0, H - 35, W, 35).fill(COLORS.primary);
  doc.font('Helvetica').fontSize(8).fillColor(COLORS.gray)
     .text('Generated by Äbugida School Management System (ASMS) — Confidential',
       PL, H - 22, { width: CW, align: 'center' });

  doc.end();
};


// ═══════════════════════════════════════════════════════════════
// 2. STUDENT ID CARD PDF
// ═══════════════════════════════════════════════════════════════
const generateStudentIDCard = async (data, res) => {
  const { student, school } = data;

  // Credit card size: 85.6mm × 54mm = 242.6pt × 153pt
  const CARD_W = 242.6;
  const CARD_H = 153;

  const doc = new PDFDocument({
    size:    [CARD_W, CARD_H],
    margins: { top: 0, bottom: 0, left: 0, right: 0 },
  });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition',
    `attachment; filename="id-card-${student.student_number}.pdf"`);
  doc.pipe(res);

  // ── Front Side ────────────────────────────────────────────────

  // Background
  doc.rect(0, 0, CARD_W, CARD_H).fill(COLORS.primary);

  // Gold top stripe
  doc.rect(0, 0, CARD_W, 6).fill(COLORS.gold);

  // Ethiopian flag stripe at bottom
  doc.rect(0, CARD_H - 4, CARD_W * 0.33, 4).fill('#009A44');
  doc.rect(CARD_W * 0.33, CARD_H - 4, CARD_W * 0.34, 4).fill(COLORS.gold);
  doc.rect(CARD_W * 0.67, CARD_H - 4, CARD_W * 0.33, 4).fill('#EF2118');

  // School name
  doc.font('Helvetica-Bold').fontSize(7).fillColor(COLORS.gold)
     .text(school?.name || 'Äbugida School', 10, 12, { width: CARD_W - 20 });
  doc.font('Helvetica').fontSize(5.5).fillColor(COLORS.gray)
     .text('STUDENT IDENTIFICATION CARD', 10, 22, { width: CARD_W - 20 });

  // Divider
  doc.rect(10, 30, CARD_W - 20, 0.5).fill(COLORS.gold);

  // Avatar circle
  doc.circle(32, 75, 22).fill('#2C3E50');
  doc.font('Helvetica-Bold').fontSize(14).fillColor(COLORS.gold)
     .text(
       (student.first_name?.[0] || '') + (student.last_name?.[0] || ''),
       10, 65, { width: 44, align: 'center' }
     );

  // Student details
  const detX = 62;
  doc.font('Helvetica-Bold').fontSize(9).fillColor(COLORS.white)
     .text(`${student.first_name} ${student.last_name}`, detX, 35, { width: CARD_W - detX - 10 });

  doc.font('Helvetica').fontSize(6.5).fillColor(COLORS.gray);
  if (student.fathers_name) {
    doc.text(`Father: ${student.fathers_name}`, detX, 47, { width: CARD_W - detX - 10 });
  }
  doc.text(`Class: ${student.class_name || 'N/A'}`, detX, student.fathers_name ? 57 : 47,
    { width: CARD_W - detX - 10 });
  doc.text(`Year: ${student.academic_year || '2024/2025'}`, detX, student.fathers_name ? 67 : 57,
    { width: CARD_W - detX - 10 });
  doc.text(`Gender: ${student.gender || 'N/A'}`, detX, student.fathers_name ? 77 : 67,
    { width: CARD_W - detX - 10 });

  // Student ID number
  doc.rect(10, CARD_H - 40, CARD_W - 20, 18).fill('#2C3E50');
  doc.font('Helvetica').fontSize(6).fillColor(COLORS.gray)
     .text('STUDENT ID', 14, CARD_H - 37);
  doc.font('Helvetica-Bold').fontSize(9).fillColor(COLORS.gold)
     .text(student.student_number, 14, CARD_H - 28);

  // QR Code placeholder area
  const qrX = CARD_W - 50;
  const qrY = CARD_H - 52;
  doc.rect(qrX, qrY, 40, 40).fill('#2C3E50');

  // Generate QR code as data URL
  try {
    const qrData   = JSON.stringify({
      id:     student.id,
      number: student.student_number,
      school: school?.code || 'ASMS',
    });
    const qrBuffer = await QRCode.toBuffer(qrData, {
      width:  80,
      margin: 1,
      color:  { dark: '#000000', light: '#FFFFFF' },
    });
    doc.image(qrBuffer, qrX + 2, qrY + 2, { width: 36, height: 36 });
  } catch (e) {
    // QR failed — show text fallback
    doc.font('Helvetica').fontSize(5).fillColor(COLORS.gray)
       .text('QR', qrX + 14, qrY + 16);
  }

  // Valid until
  const nextYear = new Date().getFullYear() + 1;
  doc.font('Helvetica').fontSize(5.5).fillColor(COLORS.gray)
     .text(`Valid: July ${nextYear}`, 10, CARD_H - 22);

  doc.end();
};


// ═══════════════════════════════════════════════════════════════
// 3. TEACHER ID CARD PDF
// ═══════════════════════════════════════════════════════════════
const generateTeacherIDCard = async (data, res) => {
  const { teacher, school } = data;

  const CARD_W = 242.6;
  const CARD_H = 153;

  const doc = new PDFDocument({
    size:    [CARD_W, CARD_H],
    margins: { top: 0, bottom: 0, left: 0, right: 0 },
  });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition',
    `attachment; filename="id-card-${teacher.teacher_number}.pdf"`);
  doc.pipe(res);

  // Background — slightly different color for teachers
  doc.rect(0, 0, CARD_W, CARD_H).fill('#0D2137');

  // Teal top stripe (different from student gold)
  doc.rect(0, 0, CARD_W, 6).fill('#38B2AC');

  // Ethiopian flag stripe at bottom
  doc.rect(0, CARD_H - 4, CARD_W * 0.33, 4).fill('#009A44');
  doc.rect(CARD_W * 0.33, CARD_H - 4, CARD_W * 0.34, 4).fill(COLORS.gold);
  doc.rect(CARD_W * 0.67, CARD_H - 4, CARD_W * 0.33, 4).fill('#EF2118');

  // School name
  doc.font('Helvetica-Bold').fontSize(7).fillColor('#38B2AC')
     .text(school?.name || 'Äbugida School', 10, 12, { width: CARD_W - 20 });
  doc.font('Helvetica').fontSize(5.5).fillColor(COLORS.gray)
     .text('STAFF IDENTIFICATION CARD', 10, 22, { width: CARD_W - 20 });

  // Divider
  doc.rect(10, 30, CARD_W - 20, 0.5).fill('#38B2AC');

  // Avatar
  doc.circle(32, 75, 22).fill('#1A3A4A');
  doc.font('Helvetica-Bold').fontSize(14).fillColor('#38B2AC')
     .text(
       (teacher.first_name?.[0] || '') + (teacher.last_name?.[0] || ''),
       10, 65, { width: 44, align: 'center' }
     );

  // Teacher details
  const detX = 62;
  doc.font('Helvetica-Bold').fontSize(9).fillColor(COLORS.white)
     .text(`${teacher.first_name} ${teacher.last_name}`, detX, 35, { width: CARD_W - detX - 10 });

  doc.font('Helvetica').fontSize(6.5).fillColor(COLORS.gray)
     .text(`Specialization: ${teacher.specialization || 'N/A'}`, detX, 47, { width: CARD_W - detX - 10 })
     .text(`Qualification: ${teacher.qualification || 'N/A'}`,   detX, 57, { width: CARD_W - detX - 10 })
     .text(`Email: ${teacher.email || 'N/A'}`,                   detX, 67, { width: CARD_W - detX - 10 });

  // STAFF badge
  doc.rect(detX, 78, 40, 12).fill('#38B2AC');
  doc.font('Helvetica-Bold').fontSize(7).fillColor(COLORS.white)
     .text('TEACHER', detX + 2, 81, { width: 36, align: 'center' });

  // Teacher ID number
  doc.rect(10, CARD_H - 40, CARD_W - 20, 18).fill('#1A3A4A');
  doc.font('Helvetica').fontSize(6).fillColor(COLORS.gray)
     .text('TEACHER ID', 14, CARD_H - 37);
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#38B2AC')
     .text(teacher.teacher_number, 14, CARD_H - 28);

  // QR Code
  const qrX = CARD_W - 50;
  const qrY = CARD_H - 52;
  doc.rect(qrX, qrY, 40, 40).fill('#1A3A4A');

  try {
    const qrData   = JSON.stringify({
      id:     teacher.id,
      number: teacher.teacher_number,
      role:   'teacher',
      school: school?.code || 'ASMS',
    });
    const qrBuffer = await QRCode.toBuffer(qrData, { width: 80, margin: 1 });
    doc.image(qrBuffer, qrX + 2, qrY + 2, { width: 36, height: 36 });
  } catch (e) {
    doc.font('Helvetica').fontSize(5).fillColor(COLORS.gray)
       .text('QR', qrX + 14, qrY + 16);
  }

  const nextYear = new Date().getFullYear() + 1;
  doc.font('Helvetica').fontSize(5.5).fillColor(COLORS.gray)
     .text(`Valid: July ${nextYear}`, 10, CARD_H - 22);

  doc.end();
};


module.exports = {
  generateReportCard,
  generateStudentIDCard,
  generateTeacherIDCard,
};
