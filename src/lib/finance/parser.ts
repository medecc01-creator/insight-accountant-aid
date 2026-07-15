import Papa from "papaparse";
import * as XLSX from "xlsx";
import type { Transaction } from "./types";

/** Read a spreadsheet (CSV / XLS / XLSX) and return CSV text with `;` delimiter. */
export async function readSpreadsheetAsCSV(file: File): Promise<string> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".xls") || name.endsWith(".xlsx")) {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array", cellDates: false });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    return XLSX.utils.sheet_to_csv(sheet, { FS: ";" });
  }
  const buf = await file.arrayBuffer();
  try { return new TextDecoder("utf-8", { fatal: true }).decode(buf); }
  catch { return new TextDecoder("windows-1252").decode(buf); }
}

/** Extract a cheque number from a bank libelle (e.g. "CHEQUE 6013912"). */
export function extractChequeNum(raw: string): string | null {
  if (!raw) return null;
  const m = raw.match(/ch[eè]que\s*n?°?\s*(\d{3,})/i);
  return m ? m[1] : null;
}


const MONTHS_FR: Record<string, number> = {
  "janv": 1, "janvier": 1, "jan": 1,
  "févr": 2, "fev": 2, "fevr": 2, "février": 2, "fevrier": 2, "feb": 2,
  "mars": 3, "mar": 3,
  "avr": 4, "avril": 4, "apr": 4,
  "mai": 5, "may": 5,
  "juin": 6, "jun": 6,
  "juil": 7, "juillet": 7, "jul": 7,
  "août": 8, "aout": 8, "aug": 8,
  "sept": 9, "septembre": 9, "sep": 9,
  "oct": 10, "octobre": 10,
  "nov": 11, "novembre": 11,
  "déc": 12, "dec": 12, "décembre": 12, "decembre": 12,
};

export const MONTH_LABELS = [
  "Janvier","Février","Mars","Avril","Mai","Juin",
  "Juillet","Août","Septembre","Octobre","Novembre","Décembre",
];

export function parseAmount(s: string): number {
  if (!s) return 0;
  const compact = s
    .replace(/€/g, "")
    .replace(/\u00a0/g, "")
    .replace(/\s/g, "")
    .trim();
  const commaIndex = compact.lastIndexOf(",");
  const dotIndex = compact.lastIndexOf(".");
  const hasComma = commaIndex !== -1;
  const hasDot = dotIndex !== -1;
  let cleaned = compact;

  if (hasComma && hasDot) {
    // Last separator is the decimal separator: "1.234,56" or "1,234.56".
    cleaned = commaIndex > dotIndex
      ? compact.replace(/\./g, "").replace(",", ".")
      : compact.replace(/,/g, "");
  } else if (hasComma) {
    cleaned = compact.replace(/\./g, "").replace(",", ".");
  }

  if (!cleaned || cleaned === "-") return 0;
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}

/** Parse "07-juil" (given a year+month context) or "07/07/2026" */
export function parseFrDate(raw: string, defaultYear: number, defaultMonth?: number): string | null {
  if (!raw) return null;
  const s = raw.trim().toLowerCase();
  if (!s) return null;
  // dd-monthAbbr
  let m = s.match(/^(\d{1,2})[-\s\/]([a-zûéèê]+)\.?$/i);
  if (m) {
    const day = parseInt(m[1], 10);
    const mon = MONTHS_FR[m[2].replace(".", "")];
    if (mon && day) return isoDate(defaultYear, mon, day);
  }
  // dd/mm/yyyy or dd/mm/yy
  m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (m) {
    let y = parseInt(m[3], 10);
    if (y < 100) y += 2000;
    return isoDate(y, parseInt(m[2], 10), parseInt(m[1], 10));
  }
  // yyyy-mm-dd
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return isoDate(+m[1], +m[2], +m[3]);
  // day only "07"
  m = s.match(/^(\d{1,2})$/);
  if (m && defaultMonth) return isoDate(defaultYear, defaultMonth, +m[1]);
  return null;
}

function isoDate(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function detectMonthFromFilename(name: string): { month?: number; year?: number } {
  const s = name.toLowerCase();
  let month: number | undefined;
  for (const k of Object.keys(MONTHS_FR)) {
    if (s.includes(k)) { month = MONTHS_FR[k]; break; }
  }
  const y = s.match(/(20\d{2})/);
  return { month, year: y ? parseInt(y[1], 10) : undefined };
}

export interface ParsedImport {
  transactions: Transaction[];
  templates: { libelle: string }[];
  year: number;
  month: number;
}

/** Parse the personal accounting CSV (semicolon, cp1252 friendly) */
export function parseComptaCSV(text: string, filename: string): ParsedImport {
  const { month: fnMonth, year: fnYear } = detectMonthFromFilename(filename);
  const year = fnYear ?? new Date().getFullYear();
  const month = fnMonth ?? new Date().getMonth() + 1;

  const parsed = Papa.parse<string[]>(text, {
    delimiter: ";",
    skipEmptyLines: false,
  });
  const rows = parsed.data;

  const transactions: Transaction[] = [];
  const templates: { libelle: string }[] = [];

  for (const row of rows) {
    if (!row || row.length < 3) continue;
    const [col1, dateRaw, libelle, cat, rec, dep, moy] = [
      (row[0] ?? "").trim(),
      (row[1] ?? "").trim(),
      (row[2] ?? "").trim(),
      (row[3] ?? "").trim(),
      (row[4] ?? "").trim(),
      (row[5] ?? "").trim(),
      (row[6] ?? "").trim(),
    ];
    if (!libelle) continue;
    // Skip header row
    if (libelle.toLowerCase() === "libellé" || libelle.toLowerCase() === "libelle") continue;
    // Skip "Solde de départ" and "Synthèse" summary rows
    if (/^solde/i.test(col1) || /synth[eè]se/i.test(libelle)) continue;

    const recettes = parseAmount(rec);
    const depensesRaw = parseAmount(dep);
    const depenses = Math.abs(depensesRaw);
    const hasAmount = recettes !== 0 || depenses !== 0;
    const hasDate = !!dateRaw;

    // Template row: no date AND no amount
    if (!hasAmount && !hasDate) {
      templates.push({ libelle });
      continue;
    }

    transactions.push({
      id: crypto.randomUUID(),
      year,
      month,
      date: hasDate ? parseFrDate(dateRaw, year, month) : null,
      libelle,
      categorie: cat,
      recettes,
      depenses,
      moyenPaiement: moy,
      pointe: col1.toUpperCase() === "X",
    });
  }

  return { transactions, templates, year, month };
}

/** Parse a Crédit Mutuel bank statement CSV. Flexible column detection. */
export interface BankLine {
  date: string | null;
  libelle: string;
  montant: number; // signed
}

export function parseBankCSV(text: string): BankLine[] {
  // Try semicolon then comma
  const delim = text.split("\n")[0].includes(";") ? ";" : ",";
  const parsed = Papa.parse<Record<string, string>>(text, {
    delimiter: delim,
    header: true,
    skipEmptyLines: true,
  });
  const rows = parsed.data;
  if (!rows.length) return [];
  const currentYear = new Date().getFullYear();
  const headers = Object.keys(rows[0]).map((h) => h.toLowerCase());

  const findHeader = (patterns: RegExp[]) => {
    for (const p of patterns) {
      const h = headers.find((x) => p.test(x));
      if (h) return h;
    }
    return null;
  };

  const dateKey = findHeader([/^date\s*d.op/i, /^date\b/i, /op.ration/i]);
  const libKey = findHeader([/lib/i, /libell/i, /motif/i, /descr/i, /nature/i]);
  const montantKey = findHeader([/^montant/i, /^valeur/i]);
  const debitKey = findHeader([/^d[ée]bit/i]);
  const creditKey = findHeader([/^cr[ée]dit/i]);

  const originalKeys = Object.keys(rows[0]);
  const keyOf = (lower: string | null) =>
    lower ? originalKeys.find((k) => k.toLowerCase() === lower) ?? null : null;

  const dK = keyOf(dateKey);
  const lK = keyOf(libKey);
  const mK = keyOf(montantKey);
  const debK = keyOf(debitKey);
  const credK = keyOf(creditKey);

  const out: BankLine[] = [];
  for (const r of rows) {
    const dateStr = dK ? r[dK] : "";
    const lib = (lK ? r[lK] : "") ?? "";
    let montant = 0;
    if (mK) {
      montant = parseAmount(r[mK] ?? "");
    } else {
      const d = parseAmount(r[debK ?? ""] ?? "");
      const c = parseAmount(r[credK ?? ""] ?? "");
      montant = c - Math.abs(d);
    }
    if (!lib && montant === 0) continue;
    out.push({
      date: parseFrDate(dateStr ?? "", currentYear),
      libelle: (lib || "").trim(),
      montant,
    });
  }
  return out;
}

/** Clean a raw bank statement label into a readable merchant name. */
export function cleanBankLibelle(raw: string): string {
  if (!raw) return "";
  let s = raw.replace(/\s+/g, " ").trim();

  // Strip common French bank prefixes
  const prefixes = [
    /^PAIEMENT\s+CB\s+\d{2,4}(\/\d{2,4})?\s*/i,
    /^CB\s+\d{2,4}(\/\d{2,4})?\s*/i,
    /^ACHAT\s+CB\s+\d{2,4}(\/\d{2,4})?\s*/i,
    /^CARTE\s+\d{2,}\s*/i,
    /^PRLV\s+SEPA\s+/i,
    /^PRELEVEMENT\s+SEPA\s+/i,
    /^PRLV\s+/i,
    /^PRELEVEMENT\s+/i,
    /^VIR\s+(SEPA\s+|INST\s+|RECU\s+|EMIS\s+)?/i,
    /^VIREMENT\s+(SEPA\s+|INSTANTANE\s+|RECU\s+|EMIS\s+|EN\s+FAVEUR\s+DE\s+)?/i,
    /^RETRAIT\s+DAB\s+\d{2,4}(\/\d{2,4})?\s*/i,
    /^RETRAIT\s+/i,
    /^REMISE\s+CHEQUE\s*/i,
    /^CHEQUE\s+N?°?\s*\d*\s*/i,
    /^FRAIS\s+/i,
  ];
  for (const p of prefixes) s = s.replace(p, "");

  // Strip trailing transaction numbers / references
  s = s
    .replace(/\s+(REF|ID|MDT|MANDAT|NUM|N°)\s*[:\-]?\s*\S+.*$/i, "")
    .replace(/\s+\d{6,}\s*$/g, "") // long trailing numbers
    .replace(/\s+CB\*+\d+\s*$/i, "")
    .replace(/\s+\d{2}\/\d{2}\/\d{2,4}\s*$/g, "") // trailing dates
    .replace(/\s+\d{2}\/\d{2}\s*$/g, "");

  // Title case for all-uppercase strings (>=3 letters)
  if (/^[^a-z]+$/.test(s) && /[A-Z]/.test(s)) {
    s = s.toLowerCase().replace(/\b([a-zà-ÿ])/g, (m) => m.toUpperCase());
  }

  return s.trim().replace(/\s+/g, " ") || raw.trim();
}

