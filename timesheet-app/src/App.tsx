import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  addMonths,
  endOfMonth,
  format,
  getDaysInMonth,
  parseISO,
  startOfMonth,
  subMonths,
} from "date-fns";
import jsPDF from "jspdf";

/** ---------------- TYPES ---------------- */

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
  | "Travel (one way)"
  | "Car allowance"
  | "OFF / Rest"
  | "Bank holiday"
  | "Onshore Installation Supervisor"
  | "Site Manager"
  | "Service"
  | "Driving to site from home"
  | "Driving from site to home";

type ExpenseType = "Taxi" | "Hotel" | "Food" | "Diesel" | "Extra luggage" | "PPE" | "Other";
type PlatformType = "SOV" | "Jack-up" | "CTV / Harbour" | "N/A";

type Expense = { id: string; type: ExpenseType; amount: number; note: string };

type DayEntry = {
  dateISO: string;
  workType: WorkType;
  hours: number;

  location: string;
  serviceWorker: string;
  workDone: string;
  comment: string;

  expenses: Expense[];

  platformType: PlatformType;
  vesselPreset: string;
  vesselManual: string;
};

type Period = {
  id: string; // YYYY-MM
  label: string; // YYYY - Month
  startISO: string;
  endISO: string;
  invoiceDateISO: string;
};

type StoredUser = {
  name: string;
  ratePerHour: number; // individual rate
  entries: Record<string, DayEntry>;
  signatureDataUrl: string | null;
};

type AppState = {
  loginEmail: string;
  selectedPeriodId: string;
  selectedDateISO: string;

  lockedPeriodIds: string[];
  users: Record<string, StoredUser>;
};

const LS_KEY = "windpro_timesheet_v6_full";
const ADMIN_PASSWORD = "1234"; // schimbi tu
const COLLECTOR_EMAIL = "borot@windpro.pl";

/** ---------------- CONSTANTS ---------------- */

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
  "Travel (one way)",
  "Car allowance",
  "OFF / Rest",
  "Bank holiday",
  "Onshore Installation Supervisor",
  "Site Manager",
  "Service",
  "Driving to site from home",
  "Driving from site to home",
];

const EXP_TYPES: ExpenseType[] = ["Taxi", "Hotel", "Food", "Diesel", "Extra luggage", "PPE", "Other"];
const PLATFORM_TYPES: PlatformType[] = ["SOV", "Jack-up", "CTV / Harbour", "N/A"];
const VESSEL_PRESETS = ["Blue Tern", "Discovery Wind", "Apollo Wind", "Nobelwind", "Aeolus", "SOV (Other)", "Jack-up (Other)"];

/** ---------------- HELPERS ---------------- */

function uid(prefix = "id") {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}
function trim1(s: string) {
  return (s || "").replace(/\s+/g, " ").trim();
}
function normalizeEmail(e: string) {
  return trim1(e).toLowerCase();
}
function clampNum(n: any, fallback = 0) {
  const x = Number(n);
  return Number.isFinite(x) ? x : fallback;
}
function round2(n: number) {
  return Math.round(n * 100) / 100;
}
function todayISO() {
  return format(new Date(), "yyyy-MM-dd");
}
function safeParse<T>(raw: string | null, fallback: T): T {
  try {
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
function inRangeISO(dateISO: string, startISO: string, endISO: string) {
  return dateISO >= startISO && dateISO <= endISO;
}
function makeDefaultEntry(dateISO: string): DayEntry {
  return {
    dateISO,
    workType: "Offshore Night Shift (SOV)",
    hours: 0,
    location: "",
    serviceWorker: "",
    workDone: "",
    comment: "",
    expenses: [],
    platformType: "SOV",
    vesselPreset: "Blue Tern",
    vesselManual: "Blue Tern",
  };
}
function makeDefaultUser(): StoredUser {
  return { name: "", ratePerHour: 0, entries: {}, signatureDataUrl: null };
}
function generateMonthlyPeriodsUntil2050(): Period[] {
  const start = new Date(2025, 0, 1);
  const end = new Date(2050, 11, 1);

  const periods: Period[] = [];
  let cur = startOfMonth(start);

  while (cur <= end) {
    const s = startOfMonth(cur);
    const e = endOfMonth(cur);
    const id = format(cur, "yyyy-MM");
    periods.push({
      id,
      label: `${format(cur, "yyyy")} - ${format(cur, "MMMM")}`,
      startISO: format(s, "yyyy-MM-dd"),
      endISO: format(e, "yyyy-MM-dd"),
      invoiceDateISO: format(e, "yyyy-MM-dd"),
    });
    cur = addMonths(cur, 1);
  }
  return periods;
}

/** ---------------- STORAGE ---------------- */

const DEFAULT_STATE: AppState = {
  loginEmail: "",
  selectedPeriodId: format(new Date(), "yyyy-MM"),
  selectedDateISO: todayISO(),
  lockedPeriodIds: [],
  users: {},
};

function loadState(): AppState {
  const s = safeParse<AppState>(localStorage.getItem(LS_KEY), DEFAULT_STATE);
  return {
    ...DEFAULT_STATE,
    ...s,
    lockedPeriodIds: s.lockedPeriodIds || [],
    users: s.users || {},
  };
}
function saveState(s: AppState) {
  localStorage.setItem(LS_KEY, JSON.stringify(s));
}

/** ---------------- STYLES ---------------- */

const input: React.CSSProperties = {
  width: "100%",
  padding: 12,
  borderRadius: 12,
  border: "1px solid #ddd",
  fontFamily: "inherit",
  fontSize: 16,
};
const strongInput: React.CSSProperties = {
  width: "100%",
  padding: 10,
  borderRadius: 12,
  border: "2px solid #111",
  fontFamily: "inherit",
  fontSize: 16,
};
const lbl: React.CSSProperties = { opacity: 0.8, marginBottom: 6 };

const smallBtn: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid #ddd",
  background: "white",
  cursor: "pointer",
  fontWeight: 700,
};

const btnBlue: React.CSSProperties = {
  padding: "12px 14px",
  borderRadius: 12,
  border: "1px solid #1f5eff",
  background: "#1f5eff",
  color: "white",
  fontWeight: 900,
  cursor: "pointer",
  whiteSpace: "nowrap",
};
const btnGreen: React.CSSProperties = {
  padding: "12px 14px",
  borderRadius: 12,
  border: "1px solid #178a3a",
  background: "#178a3a",
  color: "white",
  fontWeight: 900,
  cursor: "pointer",
  whiteSpace: "nowrap",
};
const btnGreenSplit: React.CSSProperties = {
  padding: "12px 10px",
  borderRadius: 12,
  border: "1px solid #178a3a",
  background: "#178a3a",
  color: "white",
  fontWeight: 900,
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const iconBtn: React.CSSProperties = {
  width: 40,
  height: 40,
  borderRadius: 999,
  border: "1px solid #ddd",
  background: "white",
  cursor: "pointer",
  fontSize: 22,
  lineHeight: "40px",
  textAlign: "center",
};

function dotStyle(xOffset: number): React.CSSProperties {
  return {
    position: "absolute",
    bottom: 6,
    left: "50%",
    transform: `translateX(calc(-50% + ${xOffset}px))`,
    width: 6,
    height: 6,
    borderRadius: 999,
    background: "#1f5eff",
  };
}

function Card({ title, big, children }: { title: string; big: string; children?: React.ReactNode }) {
  return (
    <div style={{ border: "1px solid #eee", background: "white", borderRadius: 14, padding: 16 }}>
      <div style={{ opacity: 0.75, marginBottom: 6 }}>{title}</div>
      <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 8 }}>{big}</div>
      <div style={{ opacity: 0.85 }}>{children}</div>
    </div>
  );
}

/** ---------------- APP ---------------- */

export default function App() {
  const periods = useMemo(() => generateMonthlyPeriodsUntil2050(), []);
  const [state, setState] = useState<AppState>(() => loadState());
  useEffect(() => saveState(state), [state]);

  const selectedPeriod = useMemo(
    () => periods.find((p) => p.id === state.selectedPeriodId) || periods[0],
    [periods, state.selectedPeriodId]
  );

  const isLocked = useMemo(
    () => state.lockedPeriodIds.includes(selectedPeriod.id),
    [state.lockedPeriodIds, selectedPeriod.id]
  );

  const activeEmail = useMemo(() => normalizeEmail(state.loginEmail), [state.loginEmail]);

  const activeUser: StoredUser = useMemo(() => {
    if (!activeEmail) return makeDefaultUser();
    return state.users[activeEmail] || makeDefaultUser();
  }, [state.users, activeEmail]);

  // ensure user exists
  useEffect(() => {
    if (!activeEmail) return;
    setState((prev) => {
      if (prev.users[activeEmail]) return prev;
      return { ...prev, users: { ...prev.users, [activeEmail]: makeDefaultUser() } };
    });
  }, [activeEmail]);

  const entries = activeUser.entries || {};

  const selectedDate = useMemo(() => parseISO(state.selectedDateISO), [state.selectedDateISO]);
  const monthStart = useMemo(() => startOfMonth(selectedDate), [selectedDate]);
  const monthLabel = useMemo(() => format(monthStart, "MMMM yyyy"), [monthStart]);

  const currentEntry: DayEntry = useMemo(
    () => entries[state.selectedDateISO] || makeDefaultEntry(state.selectedDateISO),
    [entries, state.selectedDateISO]
  );

  const setUserPatch = (patch: Partial<StoredUser>) => {
    if (!activeEmail) return;
    setState((prev) => ({
      ...prev,
      users: {
        ...prev.users,
        [activeEmail]: { ...(prev.users[activeEmail] || makeDefaultUser()), ...patch },
      },
    }));
  };

  const setEntry = (patch: Partial<DayEntry>) => {
    if (!activeEmail || isLocked) return;
    setState((prev) => {
      const u = prev.users[activeEmail] || makeDefaultUser();
      const existing = u.entries[prev.selectedDateISO] || makeDefaultEntry(prev.selectedDateISO);
      const nextEntry: DayEntry = { ...existing, ...patch };
      return {
        ...prev,
        users: {
          ...prev.users,
          [activeEmail]: { ...u, entries: { ...u.entries, [prev.selectedDateISO]: nextEntry } },
        },
      };
    });
  };

  const clearDay = () => {
    if (!activeEmail || isLocked) return;
    setState((prev) => {
      const u = prev.users[activeEmail] || makeDefaultUser();
      const copy = { ...u.entries };
      delete copy[prev.selectedDateISO];
      return {
        ...prev,
        users: { ...prev.users, [activeEmail]: { ...u, entries: copy } },
      };
    });
  };

  const savedDatesInMonth = useMemo(() => {
    const all = Object.keys(entries);
    const monthStr = format(monthStart, "yyyy-MM");
    return new Set(all.filter((d) => d.startsWith(monthStr)));
  }, [entries, monthStart]);

  const days = useMemo(() => {
    const count = getDaysInMonth(monthStart);
    const firstDay = monthStart.getDay(); // 0 sunday
    const cells: { date: Date | null; iso?: string }[] = [];
    for (let i = 0; i < firstDay; i++) cells.push({ date: null });
    for (let d = 1; d <= count; d++) {
      const date = new Date(monthStart.getFullYear(), monthStart.getMonth(), d);
      cells.push({ date, iso: format(date, "yyyy-MM-dd") });
    }
    while (cells.length % 7 !== 0) cells.push({ date: null });
    return cells;
  }, [monthStart]);

  const periodEntries = useMemo(() => {
    const out: DayEntry[] = [];
    for (const [dateISO, entry] of Object.entries(entries)) {
      if (inRangeISO(dateISO, selectedPeriod.startISO, selectedPeriod.endISO)) out.push(entry);
    }
    out.sort((a, b) => (a.dateISO < b.dateISO ? -1 : 1));
    return out;
  }, [entries, selectedPeriod.startISO, selectedPeriod.endISO]);

  const totals = useMemo(() => {
    const hours = periodEntries.reduce((acc, e) => acc + clampNum(e.hours, 0), 0);
    const expenses = periodEntries.reduce(
      (acc, e) => acc + (e.expenses || []).reduce((a, x) => a + clampNum(x.amount, 0), 0),
      0
    );
    const rate = clampNum(activeUser.ratePerHour, 0);
    const pay = hours * rate;
    return { hours: round2(hours), expenses: round2(expenses), pay: round2(pay), rate };
  }, [periodEntries, activeUser.ratePerHour]);

  /** ---------------- COPY MODES ---------------- */
  const [submitMenuOpen, setSubmitMenuOpen] = useState(false);

  type CopyMode = "none" | "copy_day_select";
  const [copyMode, setCopyMode] = useState<CopyMode>("none");
  const [copySourceDateISO, setCopySourceDateISO] = useState<string | null>(null);
  const [copyTargets, setCopyTargets] = useState<Record<string, true>>({}); // selected days

  const startCopyMyDay = () => {
    if (!activeEmail) return alert("Bagă Login email.");
    const src = state.selectedDateISO;
    const srcEntry = entries[src];
    if (!srcEntry) return alert("Nu ai entry salvat pe ziua asta. Pune datele și salvează ziua întâi.");
    setCopyMode("copy_day_select");
    setCopySourceDateISO(src);
    setCopyTargets({});
    setSubmitMenuOpen(false);
  };

  const toggleCopyTarget = (iso: string) => {
    if (!copySourceDateISO) return;
    if (iso === copySourceDateISO) return; // nu copiem peste sursă
    setCopyTargets((prev) => {
      const next = { ...prev };
      if (next[iso]) delete next[iso];
      else next[iso] = true;
      return next;
    });
  };

  const applyCopyMyDay = () => {
    if (!activeEmail) return;
    if (!copySourceDateISO) return;
    const src = entries[copySourceDateISO];
    if (!src) return alert("Source day missing.");

    const targetISOs = Object.keys(copyTargets);
    if (targetISOs.length === 0) return alert("Selectează cel puțin o zi în calendar.");

    if (isLocked) return alert("Perioada este locked. Unlock (Admin) ca să copiezi.");

    setState((prev) => {
      const u = prev.users[activeEmail] || makeDefaultUser();
      const nextEntries = { ...u.entries };

      for (const iso of targetISOs) {
        nextEntries[iso] = {
          ...src,
          dateISO: iso,
        };
      }

      return {
        ...prev,
        users: {
          ...prev.users,
          [activeEmail]: { ...u, entries: nextEntries },
        },
      };
    });

    // rămâi în modul de select, ca să poți bifa în continuare fără să revii la menu
    alert(`Copied ${targetISOs.length} day(s) ✅`);
  };

  const exitCopyMode = () => {
    setCopyMode("none");
    setCopySourceDateISO(null);
    setCopyTargets({});
  };

  /** Copy my colleague: copiezi toate zilele din perioada selectată către unul sau mai mulți colegi (local) */
  const copyMyColleague = () => {
    if (!activeEmail) return alert("Bagă Login email.");
    const raw = window.prompt("Emails colegi (separate prin virgulă):\nex: a@windpro.pl, b@windpro.pl");
    if (!raw) return;
    const emails = raw
      .split(",")
      .map((x) => normalizeEmail(x))
      .filter(Boolean);

    if (emails.length === 0) return;

    const payloadToCopy = periodEntries; // doar perioada selectată
    if (payloadToCopy.length === 0) return alert("Nu ai nimic de copiat în perioada selectată.");

    setState((prev) => {
      const nextUsers = { ...prev.users };

      for (const em of emails) {
        if (!em) continue;
        const u = nextUsers[em] || makeDefaultUser();
        const nextEntries = { ...u.entries };

        // copiem fiecare day entry (suprascrie dacă există)
        for (const e of payloadToCopy) {
          nextEntries[e.dateISO] = { ...e, dateISO: e.dateISO };
        }

        nextUsers[em] = { ...u, entries: nextEntries }; // NU copiem rate-ul (fiecare are rate individual)
      }

      return { ...prev, users: nextUsers };
    });

    setSubmitMenuOpen(false);
    alert(`Copied period to ${emails.length} colleague(s) ✅ (rate not copied)`);
  };

  /** ------- Expenses ------- */
  const addExpense = () => {
    if (isLocked) return;
    setEntry({
      expenses: [...(currentEntry.expenses || []), { id: uid("exp"), type: "Taxi", amount: 0, note: "" }],
    });
  };
  const updateExpense = (id: string, patch: Partial<{ type: ExpenseType; amount: number; note: string }>) => {
    if (isLocked) return;
    setEntry({
      expenses: (currentEntry.expenses || []).map((e) => (e.id === id ? { ...e, ...patch } : e)),
    });
  };
  const removeExpense = (id: string) => {
    if (isLocked) return;
    setEntry({ expenses: (currentEntry.expenses || []).filter((e) => e.id !== id) });
  };

  /** ------- Signature canvas ------- */
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);

  const sigPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (isLocked) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    drawing.current = true;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(e.clientX - rect.left, e.clientY - rect.top);
  };
  const sigPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    ctx.lineTo(e.clientX - rect.left, e.clientY - rect.top);
    ctx.stroke();
  };
  const sigPointerUp = () => {
    drawing.current = false;
  };

  const signatureSave = () => {
    if (!activeEmail || isLocked) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    setUserPatch({ signatureDataUrl: canvas.toDataURL("image/png") });
  };
  const signatureClear = () => {
    if (!activeEmail || isLocked) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setUserPatch({ signatureDataUrl: null });
  };

  /** ------- Lock / Unlock ------- */
  const lockPeriod = () => {
    setState((p) =>
      p.lockedPeriodIds.includes(selectedPeriod.id)
        ? p
        : { ...p, lockedPeriodIds: [...p.lockedPeriodIds, selectedPeriod.id] }
    );
  };
  const unlockAdmin = () => {
    const pass = window.prompt("Admin password:");
    if (pass !== ADMIN_PASSWORD) return alert("Wrong password.");
    setState((p) => ({ ...p, lockedPeriodIds: p.lockedPeriodIds.filter((id) => id !== selectedPeriod.id) }));
  };

  /** ------- PDF helpers ------- */
  const safePdfText = (s: string) => trim1(String(s || "")).replace(/[^\x09\x0A\x0D\x20-\x7E€]/g, " ");

  function buildPdfDoc(): jsPDF {
    const doc = new jsPDF({ unit: "pt", format: "a4" });

    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const margin = 36;
    const contentW = pageW - margin * 2;

    // Title
    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.text("Timesheet", margin, 46);

    // Header box
    const headerTop = 60;
    const headerH = 96;
    doc.setDrawColor(200);
    doc.rect(margin, headerTop, contentW, headerH);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);

    const leftX = margin + 12;
    const rightX = margin + contentW - 210;

    doc.text(`Period: ${safePdfText(selectedPeriod.label)}`, leftX, headerTop + 22);
    doc.text(`Invoice date: ${safePdfText(selectedPeriod.invoiceDateISO)}`, leftX, headerTop + 38);
    doc.text(`Submitted by: ${safePdfText(activeEmail)}`, leftX, headerTop + 54);
    doc.text(`Name: ${safePdfText(activeUser.name || "-")}`, leftX, headerTop + 70);
    doc.text(`Rate: € ${round2(totals.rate).toFixed(2)} / h`, leftX, headerTop + 86);

    doc.setFont("helvetica", "bold");
    doc.text(`Total hours: ${totals.hours.toFixed(2)}`, rightX, headerTop + 22);
    doc.text(`Total expenses: € ${totals.expenses.toFixed(2)}`, rightX, headerTop + 38);
    doc.text(`Total pay: € ${totals.pay.toFixed(2)}`, rightX, headerTop + 54);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text(`Generated: ${format(new Date(), "Pp")}`, rightX, headerTop + 76);

    let y = headerTop + headerH + 26;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text("Entries (Selected Period)", margin, y);
    y += 14;

    const tableX = margin;
    const tableW = contentW;

    const cols = [
      { label: "Date", w: 64 },
      { label: "Day", w: 34 },
      { label: "Work type", w: 160 },
      { label: "Vessel", w: 72 },
      { label: "Location", w: 72 },
      { label: "Hours", w: 48 },
      { label: "Rate", w: 52 },
      { label: "Pay", w: 58 },
      { label: "SW", w: 54 },
      { label: "Expenses", w: 68 },
      { label: "Work note", w: 120 },
    ];

    const sumW = cols.reduce((a, c) => a + c.w, 0);
    const scale = tableW / sumW;
    cols.forEach((c) => (c.w = Math.floor(c.w * scale)));

    const headerRowH = 20;
    const baseRowH = 18;
    const pad = 3;
    const rowMaxLines = 3;

    const drawHeader = () => {
      doc.setDrawColor(210);
      doc.setFillColor(245, 245, 245);
      doc.rect(tableX, y, tableW, headerRowH, "F");
      doc.rect(tableX, y, tableW, headerRowH);

      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);

      let cx = tableX;
      for (const c of cols) {
        doc.rect(cx, y, c.w, headerRowH);
        doc.text(c.label, cx + pad, y + 13);
        cx += c.w;
      }
      y += headerRowH;

      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
    };

    drawHeader();

    for (const e of periodEntries) {
      const vessel = safePdfText(trim1(e.vesselManual || e.vesselPreset) || "-");
      const loc = safePdfText(trim1(e.location) || "-");
      const work = safePdfText(e.workType);
      const sw = safePdfText(trim1(e.serviceWorker) || "-");
      const workNote = safePdfText(trim1(e.workDone) || "-");

      const hoursN = round2(clampNum(e.hours, 0));
      const rateN = round2(totals.rate);
      const payN = round2(hoursN * rateN);

      const expSum = round2((e.expenses || []).reduce((a, x) => a + clampNum(x.amount, 0), 0));
      const exp = `€ ${expSum.toFixed(2)}`;

      const dayNum = safePdfText(format(parseISO(e.dateISO), "d"));

      const cells = [
        safePdfText(e.dateISO),
        dayNum,
        work,
        vessel,
        loc,
        hoursN.toFixed(2),
        `€ ${rateN.toFixed(2)}`,
        `€ ${payN.toFixed(2)}`,
        sw,
        exp,
        workNote,
      ];

      const cellLines: string[][] = [];
      let maxLines = 1;

      for (let i = 0; i < cols.length; i++) {
        const lines = doc.splitTextToSize(cells[i], cols[i].w - pad * 2).slice(0, rowMaxLines);
        cellLines.push(lines);
        maxLines = Math.max(maxLines, lines.length);
      }

      const rowH = Math.max(baseRowH, 10 * maxLines + 6);

      if (y + rowH + 140 > pageH) {
        doc.addPage();
        y = margin + 30;

        doc.setFont("helvetica", "bold");
        doc.setFontSize(12);
        doc.text("Entries (Selected Period)", margin, y);
        y += 14;

        drawHeader();
      }

      let cx = tableX;
      doc.setDrawColor(220);
      doc.rect(tableX, y, tableW, rowH);

      for (let i = 0; i < cols.length; i++) {
        doc.rect(cx, y, cols[i].w, rowH);
        const lines = cellLines[i];
        for (let li = 0; li < lines.length; li++) {
          doc.text(lines[li], cx + pad, y + 12 + li * 10);
        }
        cx += cols[i].w;
      }

      y += rowH;
    }

    // Totals + signature
    y += 22;
    if (y + 110 > pageH) {
      doc.addPage();
      y = margin + 30;
    }

    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text("Totals", margin, y);
    y += 16;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text(`Hours: ${totals.hours.toFixed(2)}`, margin, y);
    y += 14;
    doc.text(`Expenses: € ${totals.expenses.toFixed(2)}`, margin, y);
    y += 14;
    doc.text(`Pay: € ${totals.pay.toFixed(2)}   (Rate: € ${round2(totals.rate).toFixed(2)} / h)`, margin, y);

    const sigBoxW = 200;
    const sigBoxH = 90;
    const sigX = pageW - margin - sigBoxW;
    const sigY = y - 36;

    doc.setFont("helvetica", "bold");
    doc.text("Signature", sigX, sigY - 8);
    doc.setDrawColor(200);
    doc.rect(sigX, sigY, sigBoxW, sigBoxH);

    if (activeUser.signatureDataUrl) {
      try {
        doc.addImage(activeUser.signatureDataUrl, "PNG", sigX + 10, sigY + 12, sigBoxW - 20, sigBoxH - 24);
      } catch {
        // ignore
      }
    }

    return doc;
  }

  const exportPdfPeriod = () => {
    if (!activeEmail) return alert("Bagă Login email.");
    const doc = buildPdfDoc();
    doc.save(`WindPro_TimeSheet_${selectedPeriod.id}_${activeEmail}.pdf`);
  };

  /** ------- Submit = Email + Lock ------- */
  const submitLockPeriod = async () => {
    if (!activeEmail) return alert("Bagă Login email.");

    try {
      const doc = buildPdfDoc();
      const dataUri = doc.output("datauristring");
      const base64 = dataUri.split(",")[1] || "";

      const resp = await fetch("/api/send-timesheet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: COLLECTOR_EMAIL,
          submittedBy: activeEmail,
          name: activeUser.name,
          periodLabel: selectedPeriod.label,
          invoiceDate: selectedPeriod.invoiceDateISO,
          ratePerHour: totals.rate,
          totalHours: totals.hours,
          totalExpenses: totals.expenses,
          totalPay: totals.pay,
          pdfFileName: `WindPro_TimeSheet_${selectedPeriod.id}_${activeEmail}.pdf`,
          pdfBase64: base64,
        }),
      });

      if (!resp.ok) {
        const txt = await resp.text();
        throw new Error(`HTTP ${resp.status} - ${txt}`);
      }

      lockPeriod();
      alert("Submit OK ✅ Email sent + period locked.");
    } catch (e: any) {
      alert(`Eroare la trimitere email: ${e?.message || e}`);
    }
  };

  /** ------- Calendar click ------- */
  const onCalendarPick = (targetISO: string) => {
    if (copyMode === "copy_day_select") {
      toggleCopyTarget(targetISO);
      return;
    }
    setState((p) => ({ ...p, selectedDateISO: targetISO }));
  };

  /** ------- Day pay ------- */
  const dayPay = useMemo(() => {
    const h = clampNum(currentEntry.hours, 0);
    const r = clampNum(activeUser.ratePerHour, 0);
    return round2(h * r);
  }, [currentEntry.hours, activeUser.ratePerHour]);

  /** ------- Close submit menu on outside click ------- */
  useEffect(() => {
    const onDown = () => setSubmitMenuOpen(false);
    if (!submitMenuOpen) return;
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [submitMenuOpen]);

  const copyTargetsCount = useMemo(() => Object.keys(copyTargets).length, [copyTargets]);

  return (
    <div style={{ maxWidth: 1280, margin: "0 auto", padding: 18, fontFamily: "Georgia, 'Times New Roman', serif" }}>
      <h1 style={{ margin: "0 0 4px 0" }}>WindPro TimeSheet</h1>
      <div style={{ opacity: 0.7, marginBottom: 12 }}>
        PDF doar pe perioada selectată (luna). Submit = email + lock. Unlock = admin.
      </div>
          <button
      onClick={testEmail}
      style={{
        marginBottom: 16,
        padding: "8px 14px",
        borderRadius: 8,
        border: "1px solid #ccc",
        background: "#f6f6f6",
        cursor: "pointer",
      }}
    >
      TEST EMAIL
    </button>


      {/* TOP BAR */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "540px 1fr auto",
          gap: 12,
          alignItems: "center",
          padding: 14,
          borderRadius: 14,
          border: "1px solid #eee",
          background: "white",
        }}
      >
        {/* Email + Name */}
        <div style={{ display: "grid", gap: 10 }}>
          <div style={{ display: "grid", gridTemplateColumns: "110px 1fr", alignItems: "center", gap: 10 }}>
            <div style={{ opacity: 0.8 }}>Login email:</div>
            <input
              value={state.loginEmail}
              onChange={(e) => setState((p) => ({ ...p, loginEmail: e.target.value }))}
              placeholder="ex: borot@windpro.pl"
              style={strongInput}
            />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "110px 1fr", alignItems: "center", gap: 10 }}>
            <div style={{ opacity: 0.8 }}>Name:</div>
            <input
              value={activeUser.name}
              onChange={(e) => setUserPatch({ name: e.target.value })}
              placeholder="ex: Bogdan Rotariu"
              style={strongInput}
              disabled={!activeEmail}
            />
          </div>
        </div>

        {/* Period */}
        <div style={{ display: "grid", gridTemplateColumns: "110px 1fr", alignItems: "center", gap: 10 }}>
          <div style={{ opacity: 0.8 }}>Pay period:</div>
          <select
            value={state.selectedPeriodId}
            onChange={(e) => setState((p) => ({ ...p, selectedPeriodId: e.target.value }))}
            style={{ padding: 10, borderRadius: 12, border: "1px solid #ddd", maxWidth: 360 }}
          >
            {periods.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </div>

        {/* Actions */}
        <div style={{ display: "flex", gap: 10, justifySelf: "end", position: "relative" }}>
          <button onClick={exportPdfPeriod} style={btnBlue} disabled={!activeEmail}>
            Export PDF (Period)
          </button>

          {/* Submit Split Button + Menu */}
          <div style={{ position: "relative", display: "flex" }} onMouseDown={(e) => e.stopPropagation()}>
            <button
              onClick={submitLockPeriod}
              style={{ ...btnGreen, borderTopRightRadius: 0, borderBottomRightRadius: 0 }}
              disabled={!activeEmail || isLocked}
              title="Submit (Email + Lock)"
            >
              Submit
            </button>
            <button
              onClick={() => setSubmitMenuOpen((p) => !p)}
              style={{ ...btnGreenSplit, borderTopLeftRadius: 0, borderBottomLeftRadius: 0 }}
              disabled={!activeEmail}
              title="Open menu"
            >
              ▾
            </button>

            {submitMenuOpen && (
              <div
                style={{
                  position: "absolute",
                  right: 0,
                  top: 48,
                  background: "white",
                  border: "1px solid #ddd",
                  borderRadius: 12,
                  boxShadow: "0 10px 25px rgba(0,0,0,0.08)",
                  overflow: "hidden",
                  minWidth: 240,
                  zIndex: 50,
                }}
              >
                <button
                  onClick={() => {
                    setSubmitMenuOpen(false);
                    submitLockPeriod();
                  }}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    padding: "12px 14px",
                    border: "none",
                    background: "white",
                    cursor: "pointer",
                    fontWeight: 800,
                  }}
                  disabled={!activeEmail || isLocked}
                >
                  Submit (Email + Lock)
                </button>

                <div style={{ height: 1, background: "#eee" }} />

                <button
                  onClick={startCopyMyDay}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    padding: "12px 14px",
                    border: "none",
                    background: "white",
                    cursor: "pointer",
                    fontWeight: 800,
                  }}
                  disabled={!activeEmail || isLocked}
                >
                  Copy my day (select days)
                </button>

                <button
                  onClick={copyMyColleague}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    padding: "12px 14px",
                    border: "none",
                    background: "white",
                    cursor: "pointer",
                    fontWeight: 800,
                  }}
                  disabled={!activeEmail || isLocked}
                >
                  Copy my colleague (period)
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Copy mode banner */}
      {copyMode === "copy_day_select" && (
        <div
          style={{
            marginTop: 12,
            padding: 12,
            borderRadius: 14,
            border: "1px solid #d6e2ff",
            background: "#f4f7ff",
            display: "flex",
            justifyContent: "space-between",
            gap: 12,
            alignItems: "center",
          }}
        >
          <div style={{ fontWeight: 800 }}>
            Copy mode: <span style={{ fontWeight: 900 }}>Copy my day</span>
            <div style={{ fontWeight: 600, opacity: 0.8, marginTop: 4 }}>
              Source day: <b>{copySourceDateISO}</b>. Click zile în calendar ca să le selectezi (multi-select). Selected:{" "}
              <b>{copyTargetsCount}</b>
            </div>
          </div>

          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={applyCopyMyDay} style={btnBlue} disabled={copyTargetsCount === 0 || isLocked}>
              Apply copy
            </button>
            <button onClick={exitCopyMode} style={smallBtn}>
              Done
            </button>
          </div>
        </div>
      )}

      {/* Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr 1fr", gap: 14, marginTop: 14 }}>
        <Card title="Selected period" big={selectedPeriod.label}>
          <div>
            {selectedPeriod.startISO} → {selectedPeriod.endISO} | Invoice {selectedPeriod.invoiceDateISO}
          </div>
          <div style={{ marginTop: 6, color: isLocked ? "#b55" : "#1f5eff", fontWeight: 700 }}>
            {isLocked ? "Locked" : "Editable"}
          </div>
        </Card>
        <Card title="Hours (period)" big={totals.hours.toFixed(2)} />
        <Card title="Expenses (period)" big={`€ ${totals.expenses.toFixed(2)}`} />
        <Card title="Pay (period)" big={`€ ${totals.pay.toFixed(2)}`}>
          <div>Rate: € {round2(totals.rate).toFixed(2)} / h</div>
        </Card>
      </div>

      {/* Main */}
      <div style={{ display: "grid", gridTemplateColumns: "420px 1fr", gap: 16, marginTop: 16 }}>
        {/* LEFT: Calendar + Signature */}
        <div style={{ borderRadius: 14, border: "1px solid #eee", padding: 16, background: "white" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <div style={{ fontSize: 24, fontWeight: 700 }}>{monthLabel}</div>
            <div style={{ display: "flex", gap: 10 }}>
              <button
                onClick={() =>
                  setState((p) => ({ ...p, selectedDateISO: format(subMonths(selectedDate, 1), "yyyy-MM-dd") }))
                }
                style={iconBtn}
              >
                ‹
              </button>
              <button
                onClick={() =>
                  setState((p) => ({ ...p, selectedDateISO: format(addMonths(selectedDate, 1), "yyyy-MM-dd") }))
                }
                style={iconBtn}
              >
                ›
              </button>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 8, marginTop: 12, opacity: 0.75 }}>
            {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d) => (
              <div key={d} style={{ textAlign: "center" }}>
                {d}
              </div>
            ))}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 8, marginTop: 10 }}>
            {days.map((cell, idx) => {
              if (!cell.date || !cell.iso) return <div key={idx} style={{ height: 44 }} />;
              const iso = cell.iso;
              const isSelectedDay = iso === state.selectedDateISO;
              const saved = savedDatesInMonth.has(iso);

              const isCopySelected = !!copyTargets[iso];
              const isSource = copySourceDateISO === iso;

              const border =
                copyMode === "copy_day_select"
                  ? isSource
                    ? "3px solid #178a3a"
                    : isCopySelected
                      ? "3px solid #1f5eff"
                      : "1px solid transparent"
                  : isSelectedDay
                    ? "3px solid #1f5eff"
                    : "1px solid transparent";

              return (
                <button
                  key={iso}
                  onClick={() => onCalendarPick(iso)}
                  style={{
                    height: 44,
                    borderRadius: 999,
                    border,
                    background: "white",
                    cursor: "pointer",
                    position: "relative",
                    fontWeight: 700,
                    opacity: copyMode === "copy_day_select" && isLocked ? 0.6 : 1,
                  }}
                  title={
                    copyMode === "copy_day_select"
                      ? isSource
                        ? "Source day"
                        : isCopySelected
                          ? "Selected target (click to unselect)"
                          : "Click to select as target"
                      : "Select day"
                  }
                >
                  {format(cell.date, "d")}
                  {saved && (
                    <>
                      <span style={dotStyle(-5)} />
                      <span style={dotStyle(5)} />
                    </>
                  )}
                </button>
              );
            })}
          </div>

          <div style={{ marginTop: 18 }}>
            <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 10 }}>Signature</div>

            <div style={{ display: "flex", gap: 10, marginBottom: 8 }}>
              <button onClick={signatureSave} style={smallBtn} disabled={!activeEmail || isLocked}>
                Save
              </button>
              <button onClick={signatureClear} style={smallBtn} disabled={!activeEmail || isLocked}>
                Clear
              </button>
              <button onClick={unlockAdmin} style={{ ...smallBtn, borderColor: "#f0bcbc", color: "#b55" }}>
                Unlock (Admin)
              </button>
            </div>

            <canvas
              width={360}
              height={150}
              ref={canvasRef}
              onPointerDown={sigPointerDown}
              onPointerMove={sigPointerMove}
              onPointerUp={sigPointerUp}
              onPointerLeave={sigPointerUp}
              style={{
                width: "100%",
                height: 150,
                borderRadius: 12,
                border: "1px solid #ddd",
                background: "white",
                touchAction: "none",
                opacity: !activeEmail || isLocked ? 0.6 : 1,
              }}
            />
          </div>
        </div>

        {/* RIGHT: Day editor */}
        <div style={{ borderRadius: 14, border: "1px solid #eee", padding: 16, background: "white" }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
            <div>
              <div style={{ fontSize: 28, fontWeight: 800 }}>{format(selectedDate, "EEEE, MMMM dd, yyyy")}</div>
              <div style={{ marginTop: 6, opacity: 0.8 }}>
                <div>
                  Date: <b>{state.selectedDateISO}</b>
                </div>
                <div>
                  Period: <b>{selectedPeriod.label}</b>
                </div>
                <div>Invoice date: {selectedPeriod.invoiceDateISO}</div>
              </div>
            </div>

            <button
              onClick={clearDay}
              style={{ ...smallBtn, borderColor: "#f0bcbc", color: "#b55" }}
              disabled={!activeEmail || isLocked}
            >
              Clear day
            </button>
          </div>

          <div style={{ marginTop: 18 }}>
            <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 10 }}>Work</div>

            {/* Work row: Work type + Hours + Rate */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 140px 170px", gap: 12, alignItems: "end" }}>
              <label>
                <div style={lbl}>Work type</div>
                <select
                  value={currentEntry.workType}
                  disabled={!activeEmail || isLocked}
                  onChange={(e) => setEntry({ workType: e.target.value as WorkType })}
                  style={{ ...input, padding: 10 }}
                >
                  {WORK_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                <div style={lbl}>Hours</div>
                <input
                  value={currentEntry.hours}
                  disabled={!activeEmail || isLocked}
                  onChange={(e) => setEntry({ hours: clampNum(e.target.value, 0) })}
                  type="number"
                  min={0}
                  step="0.25"
                  style={{ ...input, padding: 10 }}
                />
              </label>

              <label>
                <div style={lbl}>Payment rate (€ / hour)</div>
                <input
                  value={activeUser.ratePerHour}
                  disabled={!activeEmail}
                  onChange={(e) => setUserPatch({ ratePerHour: clampNum(e.target.value, 0) })}
                  type="number"
                  min={0}
                  step="0.01"
                  style={{ ...input, padding: 10 }}
                  placeholder="ex: 45"
                />
              </label>
            </div>

            <div style={{ marginTop: 10, opacity: 0.8 }}>
              Day pay: <b>€ {dayPay.toFixed(2)}</b>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 14 }}>
              <label>
                <div style={lbl}>Location</div>
                <input
                  value={currentEntry.location}
                  disabled={!activeEmail || isLocked}
                  onChange={(e) => setEntry({ location: e.target.value })}
                  placeholder="ex: Borssele"
                  style={input}
                />
              </label>

              <label>
                <div style={lbl}>Service Worker (SW)</div>
                <input
                  value={currentEntry.serviceWorker}
                  disabled={!activeEmail || isLocked}
                  onChange={(e) => setEntry({ serviceWorker: e.target.value })}
                  placeholder="ex: 67008943"
                  style={input}
                />
              </label>
            </div>

            <label style={{ display: "block", marginTop: 14 }}>
              <div style={lbl}>Work note</div>
              <input
                value={currentEntry.workDone}
                disabled={!activeEmail || isLocked}
                onChange={(e) => setEntry({ workDone: e.target.value })}
                placeholder="GBX exchange / HV test / torque check..."
                style={input}
              />
            </label>

            <label style={{ display: "block", marginTop: 14 }}>
              <div style={lbl}>Comment</div>
              <input
                value={currentEntry.comment}
                disabled={!activeEmail || isLocked}
                onChange={(e) => setEntry({ comment: e.target.value })}
                placeholder="notes..."
                style={input}
              />
            </label>

            {/* Expenses */}
            <div style={{ marginTop: 18 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontSize: 18, fontWeight: 800 }}>Expenses</div>
                <button onClick={addExpense} style={smallBtn} disabled={!activeEmail || isLocked}>
                  + Add
                </button>
              </div>

              <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
                {(currentEntry.expenses || []).map((ex) => (
                  <div
                    key={ex.id}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "220px 140px 1fr 80px",
                      gap: 10,
                      alignItems: "center",
                    }}
                  >
                    <select
                      value={ex.type}
                      disabled={!activeEmail || isLocked}
                      onChange={(e) => updateExpense(ex.id, { type: e.target.value as ExpenseType })}
                      style={input}
                    >
                      {EXP_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>

                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={ex.amount}
                      disabled={!activeEmail || isLocked}
                      onChange={(e) => updateExpense(ex.id, { amount: clampNum(e.target.value, 0) })}
                      style={input}
                      placeholder="Amount"
                    />

                    <input
                      value={ex.note}
                      disabled={!activeEmail || isLocked}
                      onChange={(e) => updateExpense(ex.id, { note: e.target.value })}
                      style={input}
                      placeholder="note..."
                    />

                    <button
                      onClick={() => removeExpense(ex.id)}
                      style={{ ...smallBtn, borderColor: "#eee" }}
                      disabled={!activeEmail || isLocked}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>

              {/* Vessel */}
              <div style={{ marginTop: 16, padding: 14, borderRadius: 14, border: "1px solid #eee" }}>
                <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 10 }}>Vessel / Jack-up</div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <label>
                    <div style={lbl}>Platform</div>
                    <select
                      value={currentEntry.platformType}
                      disabled={!activeEmail || isLocked}
                      onChange={(e) => setEntry({ platformType: e.target.value as PlatformType })}
                      style={input}
                    >
                      {PLATFORM_TYPES.map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div />
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
                  <label>
                    <div style={lbl}>Vessel (preset)</div>
                    <select
                      value={currentEntry.vesselPreset}
                      disabled={!activeEmail || isLocked}
                      onChange={(e) => {
                        const v = e.target.value;
                        setEntry({
                          vesselPreset: v,
                          vesselManual: trim1(currentEntry.vesselManual) ? currentEntry.vesselManual : v,
                        });
                      }}
                      style={input}
                    >
                      {VESSEL_PRESETS.map((v) => (
                        <option key={v} value={v}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label>
                    <div style={lbl}>Vessel (manual)</div>
                    <input
                      value={currentEntry.vesselManual}
                      disabled={!activeEmail || isLocked}
                      onChange={(e) => setEntry({ vesselManual: e.target.value })}
                      placeholder="ex: Blue Tern"
                      style={input}
                    />
                  </label>
                </div>
              </div>
            </div>
          </div>

          {isLocked && (
            <div style={{ marginTop: 16, padding: 12, borderRadius: 12, border: "1px solid #f0bcbc", color: "#b55" }}>
              This month is locked. Use Unlock (Admin) to edit.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
async function testEmail() {
  const r = await fetch("/api/send-timesheet", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      to: "borot@windpro.pl",
      subject: "Test Timesheet",
      text: "Salut! Test email.",
    }),
  });

  const data = await r.json().catch(() => ({}));
  alert(`Status: ${r.status}\n${JSON.stringify(data, null, 2)}`);
}
