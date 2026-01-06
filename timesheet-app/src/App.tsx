import React, { useEffect, useMemo, useRef, useState } from "react";
import { DayPicker } from "react-day-picker";
import "react-day-picker/dist/style.css";
import html2canvas from "html2canvas";
import jsPDF from "jspdf";

/** =========================
 *  ADMIN PASSWORD (ONE PLACE)
 *  ========================= */
const ADMIN_PASSWORD = "R@nei251190"; // <-- schimbă aici parola ta

/** =========================
 *  Work Types + Vessels
 *  ========================= */

type WorkType =
  | "Offshore (Harbour / CTV) DAY SHIFT"
  | "Offshore (Harbour / CTV) NIGHT SHIFT"
  | "Offshore Day Shift (SOV)"
  | "Offshore Night Shift (SOV)"
  | "Offshore Standby (SOV)"
  | "Port / Harbour"
  | "Standby / On call at home"
  | "Mob / Demob rate"
  | "Overtime"
  | "Travel (8h x 22€ = 176€) one way"
  | "Car allowance"
  | "OFF / Rest";

const WORK_TYPES: WorkType[] = [
  "Offshore (Harbour / CTV) DAY SHIFT",
  "Offshore (Harbour / CTV) NIGHT SHIFT",
  "Offshore Day Shift (SOV)",
  "Offshore Night Shift (SOV)",
  "Offshore Standby (SOV)",
  "Port / Harbour",
  "Standby / On call at home",
  "Mob / Demob rate",
  "Overtime",
  "Travel (8h x 22€ = 176€) one way",
  "Car allowance",
  "OFF / Rest",
];

const VESSELS_PRESET = [
  "",
  "Blue Tern",
  "Discovery Wind",
  "Apollo Wind",
  "Other (type manually)",
] as const;

type RateMode = "hourly" | "flat";

/** Rates EXACT ca în poza ta */
const PAY_RULES: Record<WorkType, { rate: number; mode: RateMode }> = {
  "Offshore (Harbour / CTV) DAY SHIFT": { rate: 43, mode: "hourly" },
  "Offshore (Harbour / CTV) NIGHT SHIFT": { rate: 47, mode: "hourly" },
  "Offshore Day Shift (SOV)": { rate: 40, mode: "hourly" },
  "Offshore Night Shift (SOV)": { rate: 44, mode: "hourly" },
  "Offshore Standby (SOV)": { rate: 35, mode: "hourly" },

  "Car allowance": { rate: 2, mode: "flat" },
  "Standby / On call at home": { rate: 27, mode: "flat" },

  "Mob / Demob rate": { rate: 3, mode: "hourly" }, // dacă vrei "flat", îmi zici și schimb
  "Overtime": { rate: 7, mode: "hourly" },
  "Travel (8h x 22€ = 176€) one way": { rate: 176, mode: "flat" },

  "Port / Harbour": { rate: 0, mode: "flat" },
  "OFF / Rest": { rate: 0, mode: "flat" },
};

/** =========================
 *  Pay periods
 *  ========================= */

type PayPeriod = {
  year: number;
  period: number; // 1..12
  month: string;
  weekStart: number;
  weekEnd: number;
  invoiceDate: string; // DD.MM.YYYY
};

/** =========================
 *  Entries
 *  ========================= */

type Expenses = {
  taxi: number;
  hotel: number;
  food: number;
  diesel: number;
  ppe: number;
  other: number;
  note: string;
};

type DayEntry = {
  dateISO: string; // YYYY-MM-DD
  location: string;
  vessel: string; // NEW
  workType: WorkType;
  how: string;
  hours: number;
  serviceWorker: string;
  comment: string;
  expenses: Expenses;
};

type PeriodKey = string; // "2026-P2"

type LockedPeriods = Record<
  PeriodKey,
  {
    locked: boolean;
    lockedAtISO: string;
    submittedBy: string;
  }
>;

const DEFAULT_EXPENSES: Expenses = {
  taxi: 0,
  hotel: 0,
  food: 0,
  diesel: 0,
  ppe: 0,
  other: 0,
  note: "",
};

function defaultEntry(dateISO: string): DayEntry {
  return {
    dateISO,
    location: "",
    vessel: "",
    workType: "OFF / Rest",
    how: "",
    hours: 0,
    serviceWorker: "",
    comment: "",
    expenses: { ...DEFAULT_EXPENSES },
  };
}

/** =========================
 *  Utils
 *  ========================= */

function toISO(d: Date) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function fromISO(iso: string) {
  return new Date(iso + "T00:00:00");
}

function niceDate(d: Date) {
  return d.toLocaleDateString(undefined, {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function getISOWeek(date: Date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7; // Mon=1..Sun=7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return { isoYear: d.getUTCFullYear(), isoWeek: weekNo };
}

function isWeekInRange(week: number, start: number, end: number) {
  if (start <= end) return week >= start && week <= end;
  return week >= start || week <= end; // wrap 52–3
}

function periodKey(year: number, period: number): PeriodKey {
  return `${year}-P${period}`;
}

function sumExpenses(e: Expenses) {
  return (
    (Number(e.taxi) || 0) +
    (Number(e.hotel) || 0) +
    (Number(e.food) || 0) +
    (Number(e.diesel) || 0) +
    (Number(e.ppe) || 0) +
    (Number(e.other) || 0)
  );
}

function fmtDDMMYYYY(d: Date) {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}.${mm}.${yyyy}`;
}

function lastBusinessDayOfMonth(year: number, monthIndex0: number) {
  const d = new Date(year, monthIndex0 + 1, 0);
  const dow = d.getDay(); // 0 Sun, 6 Sat
  if (dow === 0) d.setDate(d.getDate() - 2);
  if (dow === 6) d.setDate(d.getDate() - 1);
  return d;
}

function buildPayPeriods(startYear: number, endYear: number): PayPeriod[] {
  const months = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];

  const ranges: Array<{ weekStart: number; weekEnd: number }> = [
    { weekStart: 52, weekEnd: 3 },   // P1 Jan
    { weekStart: 4, weekEnd: 7 },    // P2 Feb
    { weekStart: 8, weekEnd: 11 },   // P3 Mar
    { weekStart: 12, weekEnd: 16 },  // P4 Apr
    { weekStart: 17, weekEnd: 20 },  // P5 May
    { weekStart: 21, weekEnd: 24 },  // P6 Jun
    { weekStart: 25, weekEnd: 29 },  // P7 Jul
    { weekStart: 30, weekEnd: 33 },  // P8 Aug
    { weekStart: 34, weekEnd: 38 },  // P9 Sep
    { weekStart: 39, weekEnd: 42 },  // P10 Oct
    { weekStart: 43, weekEnd: 46 },  // P11 Nov
    { weekStart: 47, weekEnd: 51 },  // P12 Dec
  ];

  const out: PayPeriod[] = [];
  for (let y = startYear; y <= endYear; y++) {
    for (let p = 1; p <= 12; p++) {
      const mi = p - 1;
      out.push({
        year: y,
        period: p,
        month: months[mi],
        weekStart: ranges[mi].weekStart,
        weekEnd: ranges[mi].weekEnd,
        invoiceDate: fmtDDMMYYYY(lastBusinessDayOfMonth(y, mi)),
      });
    }
  }
  return out;
}

const PAY_PERIODS: PayPeriod[] = buildPayPeriods(2026, 2030);

function findPayPeriodByDate(date: Date) {
  const { isoYear, isoWeek } = getISOWeek(date);

  const sameYear = PAY_PERIODS.find((p) => p.year === isoYear && isWeekInRange(isoWeek, p.weekStart, p.weekEnd));
  if (sameYear) return sameYear;

  const prevYear = PAY_PERIODS.find((p) => p.year === isoYear - 1 && isWeekInRange(isoWeek, p.weekStart, p.weekEnd));
  if (prevYear) return prevYear;

  const nextYear = PAY_PERIODS.find((p) => p.year === isoYear + 1 && isWeekInRange(isoWeek, p.weekStart, p.weekEnd));
  if (nextYear) return nextYear;

  return null;
}

/** Pay calculation */
function calcPayEUR(entry: DayEntry): number {
  const rule = PAY_RULES[entry.workType] ?? { rate: 0, mode: "flat" as const };
  const hours = Number(entry.hours) || 0;

  if (rule.mode === "flat") return rule.rate;
  return rule.rate * hours;
}

function fmtEUR(n: number) {
  return `€ ${n.toFixed(2)}`;
}

/** =========================
 *  Signature Pad
 *  ========================= */

function useSignaturePad() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);

  function getPos(e: PointerEvent, canvas: HTMLCanvasElement) {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function ensureCanvas(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement) {
    const ratio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const w = Math.floor(rect.width * ratio);
    const h = Math.floor(rect.height * ratio);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.lineWidth = 2;
      ctx.lineCap = "round";
      ctx.strokeStyle = "#111";
    }
  }

  function start(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    drawing.current = true;
    (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
    last.current = getPos(e.nativeEvent, canvas);
  }

  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas || !drawing.current) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ensureCanvas(ctx, canvas);

    const pos = getPos(e.nativeEvent, canvas);
    const prev = last.current ?? pos;

    ctx.beginPath();
    ctx.moveTo(prev.x, prev.y);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();

    last.current = pos;
  }

  function end() {
    drawing.current = false;
    last.current = null;
  }

  function clear() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  function toDataURL() {
    const canvas = canvasRef.current;
    if (!canvas) return "";
    return canvas.toDataURL("image/png");
  }

  function loadFromDataURL(dataUrl: string) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    clear();
    if (!dataUrl) return;

    const img = new Image();
    img.onload = () => {
      ensureCanvas(ctx, canvas);
      const rect = canvas.getBoundingClientRect();
      ctx.drawImage(img, 0, 0, rect.width, rect.height);
    };
    img.src = dataUrl;
  }

  return { canvasRef, start, move, end, clear, toDataURL, loadFromDataURL };
}

/** =========================
 *  Local Storage
 *  ========================= */

const LS_EMAIL = "ts_email_v6";
const LS_ENTRIES = "ts_entries_v6";
const LS_SIGNATURE = "ts_signature_v6";
const LS_LOCKS = "ts_locks_v6";

function loadJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function saveJSON<T>(key: string, value: T) {
  localStorage.setItem(key, JSON.stringify(value));
}

/** =========================
 *  App
 *  ========================= */

export default function App() {
  const [email, setEmail] = useState<string>(() => localStorage.getItem(LS_EMAIL) || "");
  const [entries, setEntries] = useState<Record<string, DayEntry>>(() => loadJSON(LS_ENTRIES, {}));
  const [signatureDataUrl, setSignatureDataUrl] = useState<string>(() => localStorage.getItem(LS_SIGNATURE) || "");
  const [locks, setLocks] = useState<LockedPeriods>(() => loadJSON(LS_LOCKS, {}));

  const [month, setMonth] = useState<Date>(new Date());
  const [selectedDay, setSelectedDay] = useState<Date | undefined>(new Date());

  // default: 2026 P2
  const [selectedPeriod, setSelectedPeriod] = useState<{ year: number; period: number }>({ year: 2026, period: 2 });

  // vessel preset + custom
  const [vesselPreset, setVesselPreset] = useState<(typeof VESSELS_PRESET)[number]>("");

  const selectedISO = useMemo(() => (selectedDay ? toISO(selectedDay) : ""), [selectedDay]);

  const current = useMemo<DayEntry>(() => {
    if (!selectedISO) return defaultEntry("");
    return entries[selectedISO] ?? defaultEntry(selectedISO);
  }, [entries, selectedISO]);

  const payInfoForSelectedDay = useMemo(() => {
    if (!selectedDay) return null;
    const { isoYear, isoWeek } = getISOWeek(selectedDay);
    const p = findPayPeriodByDate(selectedDay);
    return { isoYear, isoWeek, period: p };
  }, [selectedDay]);

  const markedDays = useMemo(() => Object.keys(entries).map((iso) => fromISO(iso)), [entries]);

  useEffect(() => localStorage.setItem(LS_EMAIL, email), [email]);
  useEffect(() => saveJSON(LS_ENTRIES, entries), [entries]);
  useEffect(() => localStorage.setItem(LS_SIGNATURE, signatureDataUrl), [signatureDataUrl]);
  useEffect(() => saveJSON(LS_LOCKS, locks), [locks]);

  function updateCurrent(patch: Partial<DayEntry>) {
    if (!selectedISO) return;
    setEntries((prev) => {
      const base = prev[selectedISO] ?? defaultEntry(selectedISO);
      return { ...prev, [selectedISO]: { ...base, ...patch, dateISO: selectedISO } };
    });
  }

  function updateExpenses(patch: Partial<Expenses>) {
    updateCurrent({ expenses: { ...(current.expenses ?? DEFAULT_EXPENSES), ...patch } });
  }

  function clearDay() {
    if (!selectedISO) return;
    setEntries((prev) => {
      const copy = { ...prev };
      delete copy[selectedISO];
      return copy;
    });
  }

  const periodOptions = useMemo(() => {
    const map = new Map<string, PayPeriod>();
    for (const p of PAY_PERIODS) map.set(periodKey(p.year, p.period), p);
    return Array.from(map.values()).sort((a, b) => (a.year - b.year) || (a.period - b.period));
  }, []);

  const selectedPeriodObj = useMemo(() => {
    return PAY_PERIODS.find((p) => p.year === selectedPeriod.year && p.period === selectedPeriod.period) || null;
  }, [selectedPeriod]);

  const selectedPeriodIsLocked = useMemo(() => {
    const key = periodKey(selectedPeriod.year, selectedPeriod.period);
    return Boolean(locks[key]?.locked);
  }, [locks, selectedPeriod]);

  const periodEntries = useMemo(() => {
    const p = selectedPeriodObj;
    if (!p) return [] as DayEntry[];

    return Object.values(entries).filter((e) => {
      const d = fromISO(e.dateISO);
      const ep = findPayPeriodByDate(d);
      return !!ep && ep.year === p.year && ep.period === p.period;
    });
  }, [entries, selectedPeriodObj]);

  const periodTotals = useMemo(() => {
    const hours = periodEntries.reduce((s, e) => s + (Number(e.hours) || 0), 0);
    const expenses = periodEntries.reduce((s, e) => s + sumExpenses(e.expenses), 0);
    const pay = periodEntries.reduce((s, e) => s + calcPayEUR(e), 0);
    return { hours, expenses, pay };
  }, [periodEntries]);

  const isSelectedDayLocked = useMemo(() => {
    if (!selectedDay) return false;
    const p = findPayPeriodByDate(selectedDay);
    if (!p) return false;
    return Boolean(locks[periodKey(p.year, p.period)]?.locked);
  }, [selectedDay, locks]);

  /** Keep vessel preset synced with current.vessel */
  useEffect(() => {
    // when you click a date, try to match vessel to preset
    const v = (current.vessel || "").trim();
    const match = (VESSELS_PRESET as readonly string[]).find((x) => x && x.toLowerCase() === v.toLowerCase());
    if (match) setVesselPreset(match as any);
    else if (v) setVesselPreset("Other (type manually)");
    else setVesselPreset("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedISO]);

  /** Signature */
  const sig = useSignaturePad();
  useEffect(() => {
    if (signatureDataUrl) sig.loadFromDataURL(signatureDataUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function saveSignature() {
    setSignatureDataUrl(sig.toDataURL());
  }

  function clearSignature() {
    sig.clear();
    setSignatureDataUrl("");
  }

  /** PDF */
  const pdfRef = useRef<HTMLDivElement | null>(null);

  async function exportPDFPeriod({ lockAfter }: { lockAfter: boolean }) {
    if (!selectedPeriodObj) return alert("Select a pay period.");
    if (!email.trim()) return alert("Set email first (Login).");
    if (!signatureDataUrl) return alert("Add signature and press Save.");
    if (periodEntries.length === 0) return alert("No entries in selected period.");
    if (!pdfRef.current) return;

    const canvas = await html2canvas(pdfRef.current, { scale: 2, backgroundColor: "#ffffff" });
    const imgData = canvas.toDataURL("image/png");

    const pdf = new jsPDF("p", "mm", "a4");
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();

    const imgProps = pdf.getImageProperties(imgData);
    const imgWidth = pageWidth;
    const imgHeight = (imgProps.height * imgWidth) / imgProps.width;

    if (imgHeight <= pageHeight) {
      pdf.addImage(imgData, "PNG", 0, 0, imgWidth, imgHeight);
    } else {
      let y = 0;
      let remaining = imgHeight;
      while (remaining > 0) {
        pdf.addImage(imgData, "PNG", 0, -y, imgWidth, imgHeight);
        remaining -= pageHeight;
        y += pageHeight;
        if (remaining > 0) pdf.addPage();
      }
    }

    pdf.save(`timesheet_${selectedPeriodObj.year}_P${selectedPeriodObj.period}.pdf`);

    if (lockAfter) {
      const key = periodKey(selectedPeriodObj.year, selectedPeriodObj.period);
      setLocks((prev) => ({
        ...prev,
        [key]: { locked: true, lockedAtISO: new Date().toISOString(), submittedBy: email.trim() },
      }));
      alert(`Submitted & locked: ${selectedPeriodObj.year} P${selectedPeriodObj.period}`);
    }
  }

  /** Unlock (Admin) */
  function unlockSelectedPeriod() {
    if (!selectedPeriodObj) return alert("Select a pay period.");

    const key = periodKey(selectedPeriodObj.year, selectedPeriodObj.period);
    if (!locks[key]?.locked) return alert("This period is not locked.");

    const pwd = window.prompt("Admin password to UNLOCK this period:");
    if (pwd === null) return;

    if (pwd !== ADMIN_PASSWORD) return alert("Wrong password.");

    setLocks((prev) => {
      const copy = { ...prev };
      delete copy[key];
      return copy;
    });

    alert(`Unlocked: ${selectedPeriodObj.year} P${selectedPeriodObj.period}`);
  }

  const currentRate = PAY_RULES[current.workType]?.rate ?? 0;
  const currentMode = PAY_RULES[current.workType]?.mode ?? "flat";
  const currentPay = selectedISO ? calcPayEUR(current) : 0;

  return (
    <div
      style={{
        ...styles.page,
        backgroundImage: "url(/bg.jpg)", // put image in public/bg.jpg
        backgroundSize: "cover",
        backgroundPosition: "center",
        backgroundRepeat: "no-repeat",
        minHeight: "100vh",
      }}
    >
      <div style={styles.overlay}>
        <header style={styles.topbar}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 900 }}>Calendar Timesheet</div>
            <div style={{ color: "#666", fontSize: 13 }}>
              PDF doar pe perioada selectată (ex P2). Submit = export + lock. Unlock = admin.
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ fontSize: 12, color: "#666" }}>Login email:</span>
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="ex: borot@windpro.pl"
                style={{ ...styles.input, width: 220 }}
              />
            </div>

            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ fontSize: 12, color: "#666" }}>Pay period:</span>
              <select
                value={periodKey(selectedPeriod.year, selectedPeriod.period)}
                onChange={(e) => {
                  const [yy, pp] = e.target.value.split("-P");
                  setSelectedPeriod({ year: Number(yy), period: Number(pp) });
                }}
                style={{ ...styles.input, width: 360 }}
              >
                {periodOptions.map((p) => (
                  <option key={periodKey(p.year, p.period)} value={periodKey(p.year, p.period)}>
                    {p.year} - P{p.period} ({p.month}) [W{p.weekStart}–W{p.weekEnd}] Inv {p.invoiceDate}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ display: "flex", gap: 8 }}>
              <button style={styles.btnPrimary} onClick={() => exportPDFPeriod({ lockAfter: false })}>
                Export PDF (Period)
              </button>
              <button
                style={styles.btnSubmit}
                onClick={() => exportPDFPeriod({ lockAfter: true })}
                disabled={selectedPeriodIsLocked}
                title={selectedPeriodIsLocked ? "Already locked" : "Export + Lock"}
              >
                Submit (Lock Period)
              </button>
              <button
                style={styles.btnDanger}
                onClick={unlockSelectedPeriod}
                disabled={!selectedPeriodIsLocked}
                title={selectedPeriodIsLocked ? "Unlock selected period (admin)" : "Not locked"}
              >
                Unlock (Admin)
              </button>
            </div>
          </div>
        </header>

        <section style={styles.summaryRow}>
          <div style={styles.card}>
            <div style={styles.label}>Selected period</div>
            <div style={styles.value}>
              {selectedPeriodObj ? `${selectedPeriodObj.year} P${selectedPeriodObj.period} (${selectedPeriodObj.month})` : "-"}
            </div>
            <div style={{ color: "#666", fontSize: 12, marginTop: 6 }}>
              {selectedPeriodObj ? `Weeks ${selectedPeriodObj.weekStart}–${selectedPeriodObj.weekEnd} | Invoice ${selectedPeriodObj.invoiceDate}` : ""}
            </div>
            {selectedPeriodIsLocked ? (
              <div style={{ marginTop: 8, fontSize: 12, color: "#b42318", fontWeight: 800 }}>LOCKED ✅</div>
            ) : (
              <div style={{ marginTop: 8, fontSize: 12, color: "#1a73e8", fontWeight: 800 }}>Editable</div>
            )}
          </div>

          <div style={styles.card}>
            <div style={styles.label}>Hours (period)</div>
            <div style={styles.value}>{periodTotals.hours.toFixed(2)}</div>
          </div>

          <div style={styles.card}>
            <div style={styles.label}>Expenses (period)</div>
            <div style={styles.value}>{fmtEUR(periodTotals.expenses)}</div>
          </div>

          <div style={styles.card}>
            <div style={styles.label}>Pay (period)</div>
            <div style={styles.value}>{fmtEUR(periodTotals.pay)}</div>
          </div>
        </section>

        <div style={styles.grid}>
          {/* Calendar + signature */}
          <div style={styles.cardPad}>
            <DayPicker
              mode="single"
              selected={selectedDay}
              onSelect={(d) => setSelectedDay(d ?? undefined)}
              month={month}
              onMonthChange={setMonth}
              showOutsideDays
              modifiers={{ marked: markedDays }}
              modifiersClassNames={{ marked: "markedDay" }}
              styles={{ caption: { fontWeight: 900 } }}
            />

            <div style={{ marginTop: 10, display: "flex", gap: 10, alignItems: "center", color: "#666", fontSize: 13 }}>
              <span style={{ width: 10, height: 10, borderRadius: 999, background: "#1a73e8", display: "inline-block" }} />
              days with saved entry
            </div>

            <div style={{ marginTop: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                <div style={{ fontWeight: 900 }}>Signature</div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button style={styles.btn} onClick={saveSignature}>Save</button>
                  <button style={styles.btnDanger} onClick={clearSignature}>Clear</button>
                </div>
              </div>

              <div style={{ color: "#666", fontSize: 12, marginTop: 6 }}>
                Semnează aici. Pentru PDF trebuie să dai <b>Save</b>.
              </div>

              <div style={{ marginTop: 10, border: "1px solid #e3e3e3", borderRadius: 12, overflow: "hidden" }}>
                <canvas
                  ref={sig.canvasRef}
                  style={{ width: "100%", height: 140, display: "block", background: "#fff" }}
                  onPointerDown={sig.start}
                  onPointerMove={sig.move}
                  onPointerUp={sig.end}
                  onPointerLeave={sig.end}
                />
              </div>

              {signatureDataUrl ? (
                <div style={{ marginTop: 8, fontSize: 12, color: "#1a73e8" }}>Signature saved ✅</div>
              ) : (
                <div style={{ marginTop: 8, fontSize: 12, color: "#999" }}>No saved signature</div>
              )}
            </div>
          </div>

          {/* Editor */}
          <div style={styles.cardPad}>
            {!selectedDay ? (
              <div style={{ color: "#666" }}>Selectează o zi.</div>
            ) : (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
                  <div>
                    <div style={{ fontSize: 18, fontWeight: 900 }}>{niceDate(selectedDay)}</div>
                    <div style={{ color: "#666", fontSize: 13 }}>Date: {selectedISO}</div>

                    {payInfoForSelectedDay ? (
                      <div style={{ marginTop: 10, fontSize: 13, color: "#444", lineHeight: 1.35 }}>
                        <div><b>ISO Week:</b> W{payInfoForSelectedDay.isoWeek} ({payInfoForSelectedDay.isoYear})</div>
                        {payInfoForSelectedDay.period ? (
                          <>
                            <div><b>Pay Period:</b> {payInfoForSelectedDay.period.year} P{payInfoForSelectedDay.period.period} ({payInfoForSelectedDay.period.month})</div>
                            <div><b>Weeks:</b> {payInfoForSelectedDay.period.weekStart}–{payInfoForSelectedDay.period.weekEnd}</div>
                            <div><b>Invoice date:</b> {payInfoForSelectedDay.period.invoiceDate}</div>
                          </>
                        ) : (
                          <div style={{ color: "#999" }}>No pay period found</div>
                        )}
                      </div>
                    ) : null}

                    {isSelectedDayLocked ? (
                      <div style={{ marginTop: 10, padding: 10, borderRadius: 12, background: "#fff5f5", border: "1px solid #f1c4c4", color: "#b42318", fontSize: 13, fontWeight: 800 }}>
                        LOCKED period → read-only
                      </div>
                    ) : null}
                  </div>

                  {!isSelectedDayLocked && (
                    <div style={{ display: "flex", gap: 8 }}>
                      <button style={styles.btnDanger} onClick={clearDay}>Clear day</button>
                    </div>
                  )}
                </div>

                <div style={styles.sectionTitle}>Work</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <div>
                    <div style={styles.label}>Work type</div>
                    <select
                      value={current.workType}
                      onChange={(e) => updateCurrent({ workType: e.target.value as WorkType })}
                      style={styles.input}
                      disabled={isSelectedDayLocked}
                    >
                      {WORK_TYPES.map((t) => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                    <div style={{ marginTop: 6, fontSize: 12, color: "#666" }}>
                      Rate: <b>{fmtEUR(currentRate)}</b> ({currentMode === "hourly" ? "per hour" : "flat"})
                      {" "}• Day pay: <b>{fmtEUR(currentPay)}</b>
                    </div>
                  </div>

                  <div>
                    <div style={styles.label}>Hours</div>
                    <input
                      type="number"
                      min={0}
                      step={0.25}
                      value={current.hours}
                      onChange={(e) => updateCurrent({ hours: Number(e.target.value) })}
                      style={styles.input}
                      disabled={isSelectedDayLocked}
                    />
                  </div>

                  <div>
                    <div style={styles.label}>Location</div>
                    <input
                      value={current.location}
                      onChange={(e) => updateCurrent({ location: e.target.value })}
                      style={styles.input}
                      disabled={isSelectedDayLocked}
                      placeholder="Site / Turbine / Port"
                    />
                  </div>

                  <div>
                    <div style={styles.label}>Service Worker</div>
                    <input
                      value={current.serviceWorker}
                      onChange={(e) => updateCurrent({ serviceWorker: e.target.value })}
                      style={styles.input}
                      disabled={isSelectedDayLocked}
                      placeholder="SW 6231482"
                    />
                  </div>

                  <div style={{ gridColumn: "1 / -1" }}>
                    <div style={styles.label}>How / Work done</div>
                    <input
                      value={current.how}
                      onChange={(e) => updateCurrent({ how: e.target.value })}
                      style={styles.input}
                      disabled={isSelectedDayLocked}
                      placeholder="HV test, torque check..."
                    />
                  </div>

                  <div style={{ gridColumn: "1 / -1" }}>
                    <div style={styles.label}>Comment</div>
                    <input
                      value={current.comment}
                      onChange={(e) => updateCurrent({ comment: e.target.value })}
                      style={styles.input}
                      disabled={isSelectedDayLocked}
                      placeholder="notes..."
                    />
                  </div>
                </div>

                <div style={styles.sectionTitle}>Expenses</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                  <ExpenseField label="Taxi (€)" value={current.expenses.taxi} onChange={(v) => updateExpenses({ taxi: v })} disabled={isSelectedDayLocked} />
                  <ExpenseField label="Hotel (€)" value={current.expenses.hotel} onChange={(v) => updateExpenses({ hotel: v })} disabled={isSelectedDayLocked} />
                  <ExpenseField label="Food (€)" value={current.expenses.food} onChange={(v) => updateExpenses({ food: v })} disabled={isSelectedDayLocked} />
                  <ExpenseField label="Diesel (€)" value={current.expenses.diesel} onChange={(v) => updateExpenses({ diesel: v })} disabled={isSelectedDayLocked} />
                  <ExpenseField label="PPE (€)" value={current.expenses.ppe} onChange={(v) => updateExpenses({ ppe: v })} disabled={isSelectedDayLocked} />
                  <ExpenseField label="Other (€)" value={current.expenses.other} onChange={(v) => updateExpenses({ other: v })} disabled={isSelectedDayLocked} />
                </div>

                <div style={{ marginTop: 10 }}>
                  <div style={styles.label}>Expenses note</div>
                  <input
                    value={current.expenses.note}
                    onChange={(e) => updateExpenses({ note: e.target.value })}
                    style={styles.input}
                    disabled={isSelectedDayLocked}
                  />
                </div>

                <div style={{ marginTop: 10, color: "#666", fontSize: 13 }}>
                  Total expenses day: <b>{fmtEUR(sumExpenses(current.expenses))}</b>
                </div>

                {/* NEW Vessel */}
                <div style={styles.sectionTitle}>Vessel / Jack-up</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <div>
                    <div style={styles.label}>Vessel (preset)</div>
                    <select
                      value={vesselPreset}
                      onChange={(e) => {
                        const v = e.target.value as any;
                        setVesselPreset(v);
                        if (v === "") updateCurrent({ vessel: "" });
                        else if (v !== "Other (type manually)") updateCurrent({ vessel: v });
                      }}
                      style={styles.input}
                      disabled={isSelectedDayLocked}
                    >
                      {VESSELS_PRESET.map((v) => (
                        <option key={v} value={v}>{v || "—"}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <div style={styles.label}>Vessel (manual)</div>
                    <input
                      value={current.vessel}
                      onChange={(e) => {
                        updateCurrent({ vessel: e.target.value });
                        setVesselPreset("Other (type manually)");
                      }}
                      style={styles.input}
                      disabled={isSelectedDayLocked}
                      placeholder="ex: Blue Tern / Discovery Wind / Apollo Wind"
                    />
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        {/* PDF layout hidden */}
        <div style={{ position: "absolute", left: -99999, top: 0 }}>
          <div ref={pdfRef} style={{ width: 794, padding: 24, fontFamily: "Arial, sans-serif", background: "#fff", color: "#111" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 20 }}>
              <div>
                <div style={{ fontSize: 22, fontWeight: 900 }}>Timesheet</div>
                <div style={{ marginTop: 4, fontSize: 14 }}>
                  Period: <b>{selectedPeriodObj ? `${selectedPeriodObj.year} P${selectedPeriodObj.period} (${selectedPeriodObj.month})` : "-"}</b>
                </div>
                <div style={{ marginTop: 4, fontSize: 14 }}>
                  Weeks: <b>{selectedPeriodObj ? `${selectedPeriodObj.weekStart}–${selectedPeriodObj.weekEnd}` : "-"}</b>
                </div>
                <div style={{ marginTop: 4, fontSize: 14 }}>
                  Invoice date: <b>{selectedPeriodObj ? selectedPeriodObj.invoiceDate : "-"}</b>
                </div>
                <div style={{ marginTop: 6, fontSize: 14 }}>
                  Submitted by: <b>{email || "-"}</b>
                </div>
              </div>

              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 14 }}>Total hours: <b>{periodTotals.hours.toFixed(2)}</b></div>
                <div style={{ fontSize: 14 }}>Total expenses: <b>{fmtEUR(periodTotals.expenses)}</b></div>
                <div style={{ fontSize: 14 }}>Total pay: <b>{fmtEUR(periodTotals.pay)}</b></div>
                <div style={{ marginTop: 6, fontSize: 11, color: "#666" }}>Generated: {new Date().toLocaleString()}</div>
              </div>
            </div>

            <div style={{ marginTop: 12, borderTop: "1px solid #ddd" }} />

            <div style={{ marginTop: 12, fontSize: 16, fontWeight: 900 }}>Pay Rates</div>
            <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 8, fontSize: 11 }}>
              <thead>
                <tr>
                  {["Work type", "Rate", "Mode"].map((h) => (
                    <th key={h} style={{ border: "1px solid #ddd", padding: "6px", background: "#f5f7fb", textAlign: "left" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {WORK_TYPES.filter((t) => t !== "OFF / Rest").map((t) => (
                  <tr key={t}>
                    <td style={td()}>{t}</td>
                    <td style={td()}>{fmtEUR(PAY_RULES[t].rate)}</td>
                    <td style={td()}>{PAY_RULES[t].mode === "hourly" ? "per hour" : "flat"}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div style={{ marginTop: 12, borderTop: "1px solid #ddd" }} />

            <div style={{ marginTop: 12, fontSize: 16, fontWeight: 900 }}>Entries (Selected Period)</div>

            <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 10, fontSize: 10.5 }}>
              <thead>
                <tr>
                  {["Date", "ISO", "Work type", "Vessel", "Location", "Hours", "Rate", "Pay", "SW", "Expenses", "Expense note", "Work note"].map((h) => (
                    <th key={h} style={{ border: "1px solid #ddd", padding: "6px", background: "#f5f7fb", textAlign: "left" }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {periodEntries
                  .slice()
                  .sort((a, b) => a.dateISO.localeCompare(b.dateISO))
                  .map((e) => {
                    const { isoWeek } = getISOWeek(fromISO(e.dateISO));
                    const exTotal = sumExpenses(e.expenses);
                    const rule = PAY_RULES[e.workType] ?? { rate: 0, mode: "flat" as const };
                    const pay = calcPayEUR(e);
                    return (
                      <tr key={e.dateISO}>
                        <td style={td()}>{e.dateISO}</td>
                        <td style={td()}>{`W${isoWeek}`}</td>
                        <td style={td()}>{e.workType}</td>
                        <td style={td()}>{e.vessel || ""}</td>
                        <td style={td()}>{e.location}</td>
                        <td style={td()}>{Number(e.hours || 0).toFixed(2)}</td>
                        <td style={td()}>{fmtEUR(rule.rate)} {rule.mode === "hourly" ? "/h" : ""}</td>
                        <td style={td()}>{fmtEUR(pay)}</td>
                        <td style={td()}>{e.serviceWorker}</td>
                        <td style={td()}>{fmtEUR(exTotal)}</td>
                        <td style={td()}>{e.expenses.note || ""}</td>
                        <td style={td()}>{e.comment || e.how || ""}</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>

            <div style={{ marginTop: 16, display: "flex", justifyContent: "space-between", gap: 20 }}>
              <div style={{ width: "60%" }}>
                <div style={{ fontSize: 13, fontWeight: 900 }}>Totals</div>
                <div style={{ fontSize: 12, marginTop: 6 }}>Hours: <b>{periodTotals.hours.toFixed(2)}</b></div>
                <div style={{ fontSize: 12, marginTop: 4 }}>Expenses: <b>{fmtEUR(periodTotals.expenses)}</b></div>
                <div style={{ fontSize: 12, marginTop: 4 }}>Pay: <b>{fmtEUR(periodTotals.pay)}</b></div>
              </div>

              <div style={{ width: "40%", textAlign: "right" }}>
                <div style={{ fontSize: 13, fontWeight: 900 }}>Signature</div>
                <div style={{ marginTop: 8, border: "1px solid #ddd", height: 90, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {signatureDataUrl ? (
                    <img src={signatureDataUrl} alt="signature" style={{ maxWidth: "100%", maxHeight: "100%" }} />
                  ) : (
                    <span style={{ color: "#999", fontSize: 12 }}>No signature</span>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        <style>{`
          .markedDay .rdp-day_button{ position: relative; }
          .markedDay .rdp-day_button::after{
            content: "";
            position: absolute;
            width: 7px; height: 7px;
            border-radius: 999px;
            left: 50%;
            transform: translateX(-50%);
            bottom: 4px;
            background: #1a73e8;
          }
        `}</style>
      </div>
    </div>
  );
}

function ExpenseField(props: { label: string; value: number; onChange: (v: number) => void; disabled?: boolean }) {
  return (
    <div>
      <div style={styles.label}>{props.label}</div>
      <input
        type="number"
        min={0}
        step={0.01}
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
        style={styles.input}
        disabled={props.disabled}
      />
    </div>
  );
}

function td(): React.CSSProperties {
  return { border: "1px solid #ddd", padding: "6px", verticalAlign: "top" };
}

const styles: Record<string, React.CSSProperties> = {
  page: { maxWidth: 1260, margin: "0 auto", padding: 16, position: "relative" },
  overlay: { background: "rgba(255,255,255,0.82)", borderRadius: 18, padding: 12, minHeight: "calc(100vh - 32px)" },

  topbar: {
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
    padding: 14,
    borderRadius: 14,
    background: "#fff",
    boxShadow: "0 8px 20px rgba(0,0,0,0.06)",
    alignItems: "flex-start",
    flexWrap: "wrap",
  },

  summaryRow: { display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 12, marginTop: 12 },
  grid: { display: "grid", gridTemplateColumns: "420px 1fr", gap: 12, marginTop: 12 },

  card: { background: "#fff", borderRadius: 14, padding: 14, boxShadow: "0 8px 20px rgba(0,0,0,0.06)" },
  cardPad: { background: "#fff", borderRadius: 14, padding: 14, boxShadow: "0 8px 20px rgba(0,0,0,0.06)" },

  label: { fontSize: 12, color: "#666", marginBottom: 6 },
  value: { fontSize: 20, fontWeight: 900, marginTop: 6 },

  input: { width: "100%", padding: "10px 12px", border: "1px solid #e3e3e3", borderRadius: 10, outline: "none" },

  btn: { border: "1px solid #ddd", background: "#fff", padding: "8px 10px", borderRadius: 10, cursor: "pointer" },
  btnPrimary: { border: "1px solid #1a73e8", background: "#1a73e8", color: "#fff", padding: "8px 10px", borderRadius: 10, cursor: "pointer" },
  btnDanger: { border: "1px solid #f1c4c4", background: "#fff5f5", padding: "8px 10px", borderRadius: 10, cursor: "pointer" },
  btnSubmit: { border: "1px solid #0b7a2a", background: "#0b7a2a", color: "#fff", padding: "8px 10px", borderRadius: 10, cursor: "pointer" },

  sectionTitle: { marginTop: 16, marginBottom: 8, fontSize: 14, fontWeight: 900 },
};
