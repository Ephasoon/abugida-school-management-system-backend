// src/utils/ethiopianDate.js
// ============================================================
// Gregorian → Ethiopian (Amete Mihret) dates for PDFs (PHASE2_PLAN §7.2).
// The same conversion as the web app (asms-web src/lib/ethiopianDate.ts),
// through the Julian Day Number (Beyene–Kudlek), and tested against the
// same vectors (tests/fixtures/ethiopian-dates.json, suite g19).
//
//   toEthiopian('2026-10-14')         → { year: 2019, month: 2, day: 4 }
//   formatEthiopian('2026-10-14')     → 'Tikimt 4, 2019 E.C.'
//   formatEthiopian('2026-10-14', 'am') → 'ጥቅምት 4 2019 ዓ.ም.'
// ============================================================

const ETH_EPOCH = 1723856; // JDN of Meskerem 1, year 1, minus 365
const div = (a, b) => Math.floor(a / b);

const MONTHS = {
  en: ['Meskerem', 'Tikimt', 'Hidar', 'Tahsas', 'Tir', 'Yekatit', 'Megabit', 'Miyazya', 'Ginbot', 'Sene', 'Hamle', 'Nehase', 'Pagume'],
  am: ['መስከረም', 'ጥቅምት', 'ኅዳር', 'ታኅሣሥ', 'ጥር', 'የካቲት', 'መጋቢት', 'ሚያዝያ', 'ግንቦት', 'ሰኔ', 'ሐምሌ', 'ነሐሴ', 'ጳጉሜ'],
};

const gregorianToJdn = (y, m, d) => {
  const a = div(14 - m, 12);
  const yy = y + 4800 - a;
  const mm = m + 12 * a - 3;
  return d + div(153 * mm + 2, 5) + 365 * yy + div(yy, 4) - div(yy, 100) + div(yy, 400) - 32045;
};

const jdnToEthiopian = (jdn) => {
  const r = (jdn - ETH_EPOCH) % 1461;
  const n = (r % 365) + 365 * div(r, 1460);
  return {
    year: 4 * div(jdn - ETH_EPOCH, 1461) + div(r, 365) - div(r, 1460),
    month: div(n, 30) + 1,
    day: (n % 30) + 1,
  };
};

/** 'YYYY-MM-DD' or a Date → { year, month, day } (Ethiopian); null if not a date. */
const toEthiopian = (value) => {
  let y, m, d;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    [y, m, d] = [value.getFullYear(), value.getMonth() + 1, value.getDate()];
  } else {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value ?? ''));
    if (!match) return null;
    [y, m, d] = [+match[1], +match[2], +match[3]];
  }
  return jdnToEthiopian(gregorianToJdn(y, m, d));
};

/** 'Tikimt 4, 2019 E.C.' (en) or 'ጥቅምት 4 2019 ዓ.ም.' (am); '' if not a date. */
const formatEthiopian = (value, lang = 'en') => {
  const e = toEthiopian(value);
  if (!e) return '';
  return lang === 'am'
    ? `${MONTHS.am[e.month - 1]} ${e.day} ${e.year} ዓ.ም.`
    : `${MONTHS.en[e.month - 1]} ${e.day}, ${e.year} E.C.`;
};

/**
 * The Ethiopian year an academic year falls in: the Ethiopian year of its
 * end date. Not the start date: a school year may start before Meskerem 1
 * (2024-09-01 is Nehase 26, 2016), but it is the 2017 E.C. school year
 * (2024/2025, ending in Sene or Hamle 2017). The same rule as the web app.
 */
const academicYearEthiopian = (endDate) => toEthiopian(endDate)?.year ?? null;

module.exports = { toEthiopian, formatEthiopian, academicYearEthiopian, MONTHS };
