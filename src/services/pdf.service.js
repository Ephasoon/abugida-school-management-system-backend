// src/services/pdf.service.js
// ============================================================
// PDF Generation Service using PDFKit
// Generates:
//   1. Report Card PDF — professional A4 academic report
//   2. Student ID Card PDF — credit-card sized with QR code
//   3. Teacher ID Card PDF
//   4. Payment receipt PDF (M8, G5)
// ============================================================

const path        = require('path');
const PDFDocument = require('pdfkit');
const QRCode      = require('qrcode');
const { academicYearEthiopian, formatEthiopian, MONTHS } = require('../utils/ethiopianDate');
const { toCents } = require('../utils/money');

// ── Fonts (G9) ────────────────────────────────────────────────
// Noto Sans Ethiopic (SIL OFL 1.1, assets/fonts/OFL.txt) has Ethiopic and
// Latin, so Amharic names, subjects and the school name print correctly.
// PDFKit embeds only the glyphs used. Every document uses 'Body' / 'Bold'.
const FONT_DIR = path.join(__dirname, '..', '..', 'assets', 'fonts');
const newDocument = (options) => {
  const doc = new PDFDocument(options);
  doc.registerFont('Body', path.join(FONT_DIR, 'NotoSansEthiopic-Regular.ttf'));
  doc.registerFont('Bold', path.join(FONT_DIR, 'NotoSansEthiopic-Bold.ttf'));
  return doc;
};

// The Amharic school name: SCHOOL_NAME_AM, or the Äbugida default only when no
// SCHOOL_NAME is set (never a different school's name next to SCHOOL_NAME)
const SCHOOL_NAME_AM = () => process.env.SCHOOL_NAME_AM || (process.env.SCHOOL_NAME ? '' : 'አቡጊዳ ትምህርት ቤት');
const schoolLine = (school) => [school?.name || 'Äbugida School', school?.name_am ?? SCHOOL_NAME_AM()].filter(Boolean).join(' · ');
const amharicName = (...parts) => parts.filter(Boolean).join(' ');
// "2017 E.C. (2024/2025)": the Ethiopian year the school year falls in, then the stored name
const academicYearLabel = (name, endDate) => {
  const year = academicYearEthiopian(endDate);
  return year ? `${year} E.C. (${name})` : (name || '');
};
const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

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


// ═══════════════════════════════════════════════════════════════
// 1. REPORT CARD PDF (M5a, B2): both semesters and the year from the results service
// ═══════════════════════════════════════════════════════════════
// data: { student, results (results.service studentResults, or null), school }
// Scores out of 100, no letters or GPA. "Rank 2 of 36" (36 ranked); the class size and the
// number not ranked underneath. Days absent / late / excused, conduct and the homeroom
// remark per semester. Promotion for the year only, when there is a result (D17, D26).
// The footer says per semester whether it is Final (locked) or Provisional (D29).
const PROMOTION_TEXT = {
  promoted: 'Promoted · ተዛውሯል',
  not_promoted: 'Not promoted · አልተዛወረም',
  pending: 'Promotion pending · ውሳኔ በመጠባበቅ ላይ',
};
const one = (v) => (v === null || v === undefined ? '—' : Number(v).toFixed(1));
const two = (v) => (v === null || v === undefined ? '—' : Number(v).toFixed(2));
const rankText = (rank, of) => (rank ? `${rank} of ${of}` : 'not ranked');

const generateReportCard = async (data, res) => {
  const { student, results, school } = data;

  const doc = newDocument({
    size:    'A4',
    margins: { top: 40, bottom: 40, left: 50, right: 50 },
  });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition',
    `attachment; filename="report-card-${student.student_number}.pdf"`);
  doc.pipe(res);

  const W  = doc.page.width;
  const H  = doc.page.height;
  const PL = 50;
  const CW = W - PL - 50;
  const year = results?.academic_year;
  const yearLabel = year ? academicYearLabel(year.name, year.end_date) : (student.academic_year || '');
  const s1 = results?.semesters.semester1, s2 = results?.semesters.semester2, yr = results?.year;

  // ── Header ───────────────────────────────────────────────────
  doc.rect(0, 0, W, 100).fill(COLORS.primary);
  doc.rect(0, 100, W, 5).fill(COLORS.gold);
  doc.font('Bold').fontSize(16).fillColor(COLORS.white).text(schoolLine(school), PL, 20, { width: CW * 0.75 });
  doc.font('Body').fontSize(10).fillColor(COLORS.gold).text('STUDENT REPORT CARD · የተማሪ ውጤት መግለጫ', PL, 46);
  doc.font('Body').fontSize(9).fillColor(COLORS.gray)
     .text(`Academic year: ${yearLabel}`, PL, 61)
     .text(`Generated: ${formatEthiopian(todayIso())}`, PL, 74);
  doc.rect(W - 120, 20, 15, 60).fill('#009A44');
  doc.rect(W - 105, 20, 15, 60).fill(COLORS.gold);
  doc.rect(W - 90,  20, 15, 60).fill('#EF2118');

  // ── Student ──────────────────────────────────────────────────
  let y = 120;
  const am = amharicName(student.first_name_am, student.fathers_name_am, student.last_name_am);
  doc.rect(PL, y, CW, am ? 72 : 58).fill(COLORS.light_gray);
  doc.font('Bold').fontSize(13).fillColor(COLORS.primary)
     .text([student.first_name, student.fathers_name, student.last_name].filter(Boolean).join(' '), PL + 12, y + 8, { width: CW - 24 });
  let line = y + 26;
  if (am) { doc.font('Body').fontSize(11).fillColor(COLORS.primary).text(am, PL + 12, line); line += 16; }
  const cls = results?.class;
  doc.font('Body').fontSize(9).fillColor(COLORS.gray)
     .text(`Student number: ${student.student_number}   ·   Class: ${cls?.name || student.class_name || '—'}   ·   ${yearLabel}`, PL + 12, line + 2, { width: CW - 24 });
  y += (am ? 72 : 58) + 14;

  if (!results) {
    doc.font('Body').fontSize(11).fillColor(COLORS.gray).text('No results yet for this student.', PL, y);
    footer(doc, W, H, PL, CW, 'Provisional');
    doc.end();
    return;
  }

  // ── Results table: subject | semester 1 | semester 2 | year ───
  const col = { subject: PL, s1: PL + 230, s2: PL + 320, year: PL + 410 };
  const colW = 85;
  const header = () => {
    doc.rect(PL, y, CW, 20).fill(COLORS.primary);
    doc.font('Bold').fontSize(9).fillColor(COLORS.white);
    doc.text('Subject · ትምህርት', col.subject + 8, y + 6, { width: 220 });
    doc.text('Semester 1', col.s1, y + 6, { width: colW, align: 'center' });
    doc.text('Semester 2', col.s2, y + 6, { width: colW, align: 'center' });
    doc.text('Year', col.year, y + 6, { width: colW, align: 'center' });
    y += 20;
  };
  header();
  const cell = (sem, subjectId) => {
    const s = sem?.subjects.find((x) => x.subject_id === subjectId);
    if (!s) return '—';
    if (s.status === 'over_100') return 'check';
    return s.score === null ? '—' : `${one(s.score)}${s.complete ? '' : ' *'}`;
  };
  yr.subjects.forEach((sub, i) => {
    if (y > H - 200) { doc.addPage(); y = 50; header(); }
    doc.rect(PL, y, CW, 18).fill(i % 2 === 0 ? COLORS.white : COLORS.light_gray);
    doc.font('Body').fontSize(9).fillColor(COLORS.primary)
       .text([sub.name, sub.name_am].filter(Boolean).join(' · '), col.subject + 8, y + 4, { width: 220, height: 12, ellipsis: true });
    doc.fillColor(COLORS.primary);
    doc.text(cell(s1, sub.subject_id), col.s1, y + 4, { width: colW, align: 'center' });
    doc.text(cell(s2, sub.subject_id), col.s2, y + 4, { width: colW, align: 'center' });
    doc.font('Bold').text(sub.score === null ? '—' : `${one(sub.score)}${sub.complete ? '' : ' *'}`, col.year, y + 4, { width: colW, align: 'center' });
    y += 18;
  });
  if (!yr.subjects.length) {
    doc.font('Body').fontSize(9).fillColor(COLORS.gray).text('No assessments yet.', PL + 8, y + 4);
    y += 18;
  }

  // Totals, averages, ranks
  const summary = [
    ['Total', one(s1?.total), one(s2?.total), '—'],
    ['Average', two(s1?.average), two(s2?.average), two(yr.average)],
    ['Rank', rankText(s1?.rank, s1?.ranked_count), rankText(s2?.rank, s2?.ranked_count), rankText(yr.rank, yr.ranked_count)],
    ['Days absent · የቀሩበት ቀን', String(s1?.days_absent ?? 0), String(s2?.days_absent ?? 0), String(yr.days_absent ?? 0)],
    ['Late / excused', `${s1?.days_late ?? 0} / ${s1?.days_excused ?? 0}`, `${s2?.days_late ?? 0} / ${s2?.days_excused ?? 0}`, ''],
    ['Conduct · ጠባይ', s1?.conduct ?? '—', s2?.conduct ?? '—', ''],
  ];
  doc.rect(PL, y, CW, 1).fill(COLORS.border);
  y += 4;
  for (const [label, a, b, c] of summary) {
    doc.font('Bold').fontSize(9).fillColor(COLORS.primary).text(label, col.subject + 8, y + 3, { width: 220 });
    doc.font('Body').fillColor(COLORS.primary);
    doc.text(a, col.s1, y + 3, { width: colW, align: 'center' });
    doc.text(b, col.s2, y + 3, { width: colW, align: 'center' });
    doc.font('Bold').text(c, col.year, y + 3, { width: colW, align: 'center' });
    y += 16;
  }
  const notRanked = yr.class_size - yr.ranked_count;
  const legend = `Class: ${yr.class_size} students${notRanked ? `, ${notRanked} not ranked` : ''}. * incomplete: an assessment without a score, or max scores under 100; a yearly score is complete only when both semesters are. Only students complete in every subject are ranked.`;
  doc.font('Body').fontSize(8).fillColor(COLORS.gray).text(legend, PL, y + 4, { width: CW });
  y += 4 + doc.heightOfString(legend, { width: CW }) + 12;

  // Homeroom remarks
  for (const [label, sem] of [['Semester 1', s1], ['Semester 2', s2]]) {
    if (!sem?.remark) continue;
    doc.font('Bold').fontSize(9).fillColor(COLORS.primary).text(`Homeroom teacher remark, ${label}:`, PL, y);
    doc.font('Body').fontSize(9).fillColor(COLORS.primary).text(sem.remark, PL, y + 13, { width: CW });
    y += 13 + doc.heightOfString(sem.remark, { width: CW }) + 8;
  }

  // Promotion (year only)
  if (yr.promotion && PROMOTION_TEXT[yr.promotion.status]) {
    const color = yr.promotion.status === 'promoted' ? COLORS.green : yr.promotion.status === 'not_promoted' ? COLORS.red : COLORS.blue;
    doc.rect(PL, y, CW, 28).fill(COLORS.gold_light);
    doc.font('Bold').fontSize(12).fillColor(color).text(PROMOTION_TEXT[yr.promotion.status], PL, y + 8, { width: CW, align: 'center' });
    y += 40;
  }

  // Signatures
  if (y > H - 130) { doc.addPage(); y = 50; }
  doc.font('Body').fontSize(9).fillColor(COLORS.gray)
     .text('Homeroom teacher: ______________________', PL, y + 20)
     .text('Director: ______________________', PL + CW * 0.55, y + 20)
     .text('Parent: ______________________', PL, y + 45);

  footer(doc, W, H, PL, CW, `Semester 1: ${s1?.final ? 'Final' : 'Provisional'}  ·  Semester 2: ${s2?.final ? 'Final' : 'Provisional'}`);
  doc.end();
};

// Footer bar with the final / provisional state
const footer = (doc, W, H, PL, CW, state) => {
  doc.rect(0, H - 35, W, 35).fill(COLORS.primary);
  doc.font('Body').fontSize(8).fillColor(COLORS.gray)
     .text(`${state}  ·  Äbugida School Management System (ASMS) — Confidential`, PL, H - 22, { width: CW, align: 'center' });
};


// ═══════════════════════════════════════════════════════════════
// 2. STUDENT ID CARD PDF
// ═══════════════════════════════════════════════════════════════
const generateStudentIDCard = async (data, res) => {
  const { student, school } = data;

  // Credit card size: 85.6mm × 54mm = 242.6pt × 153pt
  const CARD_W = 242.6;
  const CARD_H = 153;

  const doc = newDocument({
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
  doc.font('Bold').fontSize(7).fillColor(COLORS.gold)
     .text(schoolLine(school), 10, 10, { width: CARD_W - 20, lineBreak: false });
  doc.font('Body').fontSize(5.5).fillColor(COLORS.gray)
     .text('STUDENT IDENTIFICATION CARD · የተማሪ መታወቂያ', 10, 20, { width: CARD_W - 20, lineBreak: false });

  // Divider
  doc.rect(10, 30, CARD_W - 20, 0.5).fill(COLORS.gold);

  // Avatar circle
  doc.circle(32, 75, 22).fill('#2C3E50');
  doc.font('Bold').fontSize(14).fillColor(COLORS.gold)
     .text(
       (student.first_name?.[0] || '') + (student.last_name?.[0] || ''),
       10, 65, { width: 44, align: 'center' }
     );

  // Student details
  const detX = 62;
  const detW = CARD_W - detX - 10;
  doc.font('Bold').fontSize(9).fillColor(COLORS.white)
     .text(`${student.first_name} ${student.last_name}`, detX, 33, { width: detW, lineBreak: false, ellipsis: true });
  // The Amharic name (D4) under the Latin one
  const nameAm = amharicName(student.first_name_am, student.fathers_name_am, student.last_name_am);
  let y = 45;
  if (nameAm) {
    doc.font('Body').fontSize(7.5).fillColor(COLORS.gold).text(nameAm, detX, y, { width: detW, lineBreak: false, ellipsis: true });
    y += 11;
  }

  // Dates in the Ethiopian calendar (§7.2)
  const lines = [
    student.fathers_name && `Father: ${student.fathers_name}`,
    `Class: ${student.class_name || 'N/A'}`,
    student.academic_year && `Year: ${academicYearLabel(student.academic_year, student.academic_year_end)}`,
    `Gender: ${student.gender === 'female' ? 'Female · ሴት' : student.gender === 'male' ? 'Male · ወንድ' : 'N/A'}`,
    student.date_of_birth && `Born: ${formatEthiopian(student.date_of_birth)}`,
  ].filter(Boolean);
  doc.font('Body').fontSize(6).fillColor(COLORS.gray);
  for (const line of lines) {
    if (y > CARD_H - 56) break;
    doc.text(line, detX, y, { width: detW - 44, lineBreak: false, ellipsis: true });
    y += 8.5;
  }

  // Student ID number
  // (Noto Sans Ethiopic has a taller line than Helvetica: positions allow for it)
  doc.rect(10, CARD_H - 46, CARD_W - 64, 22).fill('#2C3E50');
  doc.font('Body').fontSize(5.5).fillColor(COLORS.gray)
     .text('STUDENT ID · የተማሪ ቁጥር', 14, CARD_H - 45, { lineBreak: false });
  doc.font('Bold').fontSize(9).fillColor(COLORS.gold)
     .text(student.student_number, 14, CARD_H - 37, { lineBreak: false });

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
    doc.font('Body').fontSize(5).fillColor(COLORS.gray)
       .text('QR', qrX + 14, qrY + 16);
  }

  // Issued today, valid to the end of the academic year (Ethiopian dates)
  const valid = student.academic_year_end ? ` · Valid until ${formatEthiopian(student.academic_year_end)}` : '';
  doc.font('Body').fontSize(5).fillColor(COLORS.gray)
     .text(`Issued ${formatEthiopian(todayIso())}${valid}`, 10, CARD_H - 18, { width: CARD_W - 64, lineBreak: false });

  doc.end();
};


// ═══════════════════════════════════════════════════════════════
// 3. TEACHER ID CARD PDF
// ═══════════════════════════════════════════════════════════════
const generateTeacherIDCard = async (data, res) => {
  const { teacher, school } = data;

  const CARD_W = 242.6;
  const CARD_H = 153;

  const doc = newDocument({
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
  doc.font('Bold').fontSize(7).fillColor('#38B2AC')
     .text(schoolLine(school), 10, 10, { width: CARD_W - 20, lineBreak: false });
  doc.font('Body').fontSize(5.5).fillColor(COLORS.gray)
     .text('STAFF IDENTIFICATION CARD · የሠራተኛ መታወቂያ', 10, 20, { width: CARD_W - 20, lineBreak: false });

  // Divider
  doc.rect(10, 30, CARD_W - 20, 0.5).fill('#38B2AC');

  // Avatar
  doc.circle(32, 75, 22).fill('#1A3A4A');
  doc.font('Bold').fontSize(14).fillColor('#38B2AC')
     .text(
       (teacher.first_name?.[0] || '') + (teacher.last_name?.[0] || ''),
       10, 65, { width: 44, align: 'center' }
     );

  // Teacher details
  const detX = 62;
  const detW = CARD_W - detX - 10;
  doc.font('Bold').fontSize(9).fillColor(COLORS.white)
     .text(`${teacher.first_name} ${teacher.last_name}`, detX, 33, { width: detW, lineBreak: false, ellipsis: true });
  const nameAm = amharicName(teacher.first_name_am, teacher.last_name_am);
  let y = 45;
  if (nameAm) {
    doc.font('Body').fontSize(7.5).fillColor('#38B2AC').text(nameAm, detX, y, { width: detW, lineBreak: false, ellipsis: true });
    y += 11;
  }
  doc.font('Body').fontSize(6).fillColor(COLORS.gray);
  for (const line of [
    `Specialization: ${teacher.specialization || 'N/A'}`,
    `Qualification: ${teacher.qualification || 'N/A'}`,
    teacher.hire_date && `Since: ${formatEthiopian(teacher.hire_date)}`,
  ].filter(Boolean)) {
    doc.text(line, detX, y, { width: detW, lineBreak: false, ellipsis: true });
    y += 8.5;
  }

  // STAFF badge
  doc.rect(detX, y + 1, 40, 11).fill('#38B2AC');
  doc.font('Bold').fontSize(6.5).fillColor(COLORS.white)
     .text('TEACHER', detX + 2, y + 1.5, { width: 36, align: 'center', lineBreak: false });

  // Teacher ID number
  doc.rect(10, CARD_H - 46, CARD_W - 64, 22).fill('#1A3A4A');
  doc.font('Body').fontSize(5.5).fillColor(COLORS.gray)
     .text('TEACHER ID · የመምህር ቁጥር', 14, CARD_H - 45, { lineBreak: false });
  doc.font('Bold').fontSize(9).fillColor('#38B2AC')
     .text(teacher.teacher_number, 14, CARD_H - 37, { lineBreak: false });

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
    doc.font('Body').fontSize(5).fillColor(COLORS.gray)
       .text('QR', qrX + 14, qrY + 16);
  }

  doc.font('Body').fontSize(5).fillColor(COLORS.gray)
     .text(`Issued ${formatEthiopian(todayIso())}`, 10, CARD_H - 18, { width: CARD_W - 64, lineBreak: false });

  doc.end();
};


// ═══════════════════════════════════════════════════════════════
// 4. PAYMENT RECEIPT PDF (M8, G5): A5, English and Amharic, Ethiopian dates
// ═══════════════════════════════════════════════════════════════
// data: { receipt (finance.controller loadReceipt), school }. A reversed receipt keeps its
// number and prints "Reversed" with the reason; its lines are shown struck through.
const FEE_NAMES = {
  tuition: 'Tuition · የትምህርት ክፍያ', registration: 'Registration · ምዝገባ', material: 'Materials · የትምህርት መሳሪያ',
  exam: 'Exam · ፈተና', library: 'Library · ቤተ መጻሕፍት', sport: 'Sport · ስፖርት', uniform: 'Uniform · የደንብ ልብስ',
  transport: 'Transport · ትራንስፖርት', other: 'Other · ሌላ',
};
const METHOD_NAMES = {
  cash: 'Cash · ጥሬ ገንዘብ', telebirr: 'telebirr · ቴሌብር', cbe_birr: 'CBE Birr · ሲቢኢ ብር', mpesa: 'M-Pesa · ኤም-ፔሳ',
  bank_transfer: 'Bank transfer · የባንክ ዝውውር', other: 'Other · ሌላ',
};
const TERM_NAMES = { term1: 'Term 1 · 1ኛ ተርም', term2: 'Term 2 · 2ኛ ተርም', term3: 'Term 3 · 3ኛ ተርም' };
const etb = (v) => {
  const c = Math.abs(toCents(v));
  return `${String(Math.floor(c / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${String(c % 100).padStart(2, '0')} ETB`;
};
const receiptLineLabel = (l, ethYear) => {
  const fee = FEE_NAMES[l.category] || l.category;
  if (l.eth_month) return `${fee} — ${MONTHS.en[l.eth_month - 1]} · ${MONTHS.am[l.eth_month - 1]} ${ethYear ?? ''}`.trim();
  if (l.legacy_term) return `${fee} — ${TERM_NAMES[l.legacy_term] || l.legacy_term}`;
  return l.description ? `${fee} — ${l.description}` : fee;
};

const generateReceipt = async (data, res) => {
  const { receipt: r, school } = data;
  const doc = newDocument({ size: 'A5', margins: { top: 30, bottom: 30, left: 32, right: 32 } });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="receipt-${r.receipt_number}.pdf"`);
  doc.pipe(res);

  const W = doc.page.width;
  const PL = 32;
  const CW = W - PL * 2;
  const reversed = r.status === 'reversed';
  const yearEth = academicYearEthiopian(r.academic_year_end);

  // Header
  doc.rect(0, 0, W, 70).fill(COLORS.primary);
  doc.rect(0, 70, W, 4).fill(COLORS.gold);
  doc.font('Bold').fontSize(13).fillColor(COLORS.white).text(schoolLine(school), PL, 16, { width: CW });
  doc.font('Body').fontSize(9).fillColor(COLORS.gold).text('PAYMENT RECEIPT · የክፍያ ደረሰኝ', PL, 40);
  doc.font('Bold').fontSize(10).fillColor(COLORS.white).text(r.receipt_number, PL, 40, { width: CW, align: 'right' });

  // Receipt facts
  let y = 88;
  const row = (label, value, opts = {}) => {
    doc.font('Body').fontSize(7.5).fillColor(COLORS.gray).text(label, PL, y, { width: 120 });
    doc.font(opts.bold ? 'Bold' : 'Body').fontSize(9).fillColor(COLORS.primary).text(value || '—', PL + 125, y - 1, { width: CW - 125 });
    y = Math.max(doc.y, y + 12) + 3;
  };
  const nameAm = amharicName(r.first_name_am, r.fathers_name_am, r.last_name_am);
  row('Student · ተማሪ', [r.first_name, r.fathers_name, r.last_name].filter(Boolean).join(' '), { bold: true });
  if (nameAm) row('', nameAm);
  row('Student ID · የተማሪ ቁጥር', r.student_number);
  row('Class · ክፍል', r.class_name);
  if (r.academic_year) row('School year · የትምህርት ዘመን', academicYearLabel(r.academic_year, r.academic_year_end));
  row('Date paid · የተከፈለበት ቀን', `${formatEthiopian(r.payment_date)} · ${formatEthiopian(r.payment_date, 'am')}  (${r.payment_date})`);
  row('Method · የክፍያ ዘዴ', METHOD_NAMES[r.payment_method] || r.payment_method);
  if (r.reference) row('Reference · ማጣቀሻ', r.reference);

  // What it paid
  y += 6;
  doc.rect(PL, y, CW, 18).fill(COLORS.light_gray);
  doc.font('Bold').fontSize(8).fillColor(COLORS.primary)
     .text('For · ለ', PL + 6, y + 5, { width: CW - 110 })
     .text('Amount · መጠን', PL + CW - 100, y + 5, { width: 94, align: 'right' });
  y += 22;
  for (const l of r.lines) {
    const label = receiptLineLabel(l, yearEth);
    doc.font('Body').fontSize(8.5).fillColor(reversed ? COLORS.gray : COLORS.primary)
       .text(label, PL + 6, y, { width: CW - 110, strike: reversed })
       .text(etb(l.amount), PL + CW - 100, y, { width: 94, align: 'right', strike: reversed });
    y = Math.max(doc.y, y + 12) + 4;
    doc.rect(PL, y - 2, CW, 0.5).fill(COLORS.border);
  }
  y += 4;
  doc.font('Bold').fontSize(11).fillColor(reversed ? COLORS.gray : COLORS.primary)
     .text('Total · ጠቅላላ', PL + 6, y, { width: CW - 110 })
     .text(etb(r.amount), PL + CW - 140, y, { width: 134, align: 'right', strike: reversed });
  y = doc.y + 10;

  if (reversed) {
    doc.rect(PL, y, CW, 44).lineWidth(1.5).stroke(COLORS.red);
    doc.font('Bold').fontSize(14).fillColor(COLORS.red).text('REVERSED · ተመልሷል', PL, y + 6, { width: CW, align: 'center' });
    doc.font('Body').fontSize(7.5).fillColor(COLORS.red)
       .text(`${r.reversed_at ? formatEthiopian(String(r.reversed_at instanceof Date ? r.reversed_at.toISOString() : r.reversed_at).slice(0, 10)) : ''}${r.reversal_reason ? ` — ${r.reversal_reason}` : ''}`,
         PL + 8, y + 26, { width: CW - 16, align: 'center', lineBreak: false, ellipsis: true });
    y += 54;
  }
  if (r.notes) {
    doc.font('Body').fontSize(7.5).fillColor(COLORS.gray).text(`Note · ማስታወሻ: ${r.notes}`, PL, y, { width: CW });
    y = doc.y + 6;
  }

  // Footer
  const H = doc.page.height;
  doc.font('Body').fontSize(7.5).fillColor(COLORS.gray)
     .text(`Received by · የተቀበለው: ${r.recorded_by_name || '—'}`, PL, H - 70, { width: CW / 2 })
     .text('Signature · ፊርማ: ____________________', PL + CW / 2, H - 70, { width: CW / 2, align: 'right' });
  doc.font('Body').fontSize(6.5).fillColor(COLORS.gray)
     .text(`Printed ${formatEthiopian(todayIso())} · ${r.receipt_number}`, PL, H - 44, { width: CW, align: 'center' });
  doc.end();
};


module.exports = {
  generateReportCard,
  generateStudentIDCard,
  generateTeacherIDCard,
  generateReceipt,
};
