import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  addMonths,
  endOfMonth,
  format,
  getDaysInMonth,
  parseISO,
  startOfMonth,
} from "date-fns";
import html2canvas from "html2canvas";
import jsPDF from "jspdf";

/** ===================== TYPES ===================== */

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
  | "OFF / Rest"
  | "Bank holiday"
  | "Onshore Installation Supervisor"
  | "Site Manager"
  | "Service"
  | "Driving to site from home"
  | "Driving from site to home";

type ExpenseType = "Taxi" | "Hotel" | "Food" | "Diesel" | "Extra luggage" | "PPE" | "Other";
type PlatformType = "SOV" | "Jack-up" | "CTV / Harbour" | "N/A";

type Expense = {
  id: string;
  type: ExpenseType;
  amount: number;
  note: string;
};

type DayEntry = {
  dateISO: string;

  workType: WorkType;
  hours: number;

  /** ✅ IMPORTANT: rate saved PER DAY (fixes travel/day vs night/day issue) */
  ratePerHour: number;

  location: string;
  serviceWorker: string;

  platformType: PlatformType;
  vesselPreset: string;
  vesselManual: string;

  workNote: string;

  expenses: Expense[];
};

type StoredUser = {
  name: string;

  /** optional convenience default (used to prefill new days) */
  defaultRatePerHour: number;

  entries: Record<string, DayEntry>;
  signatureByPeriod: Record<string, string | null>; // key YYYY-MM
};

type AppState = {
  loginEmail: string;
  selectedPeriodId: string; // YYYY-MM
  selectedDateISO: string; // YYYY-MM-DD

  lockedPeriodIds: string[];

  multiMode: boolean;
  multiSelectedISOs: string[];

  users: Record<string, StoredUser>;
};

type Period = {
  id: string;
  label: string;
  startISO: string;
  endISO: string;
  invoiceDateISO: string;
};

/** ===================== CONSTS ===================== */

const LS_KEY = "windpro_timesheet_v9_day_rate_pdf_mce";
const ADMIN_PASSWORD = "1234"; // schimbă aici

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
  "Bank holiday",
  "Onshore Installation Supervisor",
  "Site Manager",
  "Service",
  "Driving to site from home",
  "Driving from site to home",
];

const EXP_TYPES: ExpenseType[] = ["Taxi", "Hotel", "Food", "Diesel", "Extra luggage", "PPE", "Other"];
const PLATFORM_TYPES: PlatformType[] = ["SOV", "Jack-up", "CTV / Harbour", "N/A"];
const VESSEL_PRESETS = [
  "Blue Tern",
  "Discovery Wind",
  "Apollo Wind",
  "Nobelwind",
  "Aeolus",
  "SOV (Other)",
  "Jack-up (Other)",
];

/** ===================== HELPERS ===================== */

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

function makeDefaultUser(): StoredUser {
  return { name: "", defaultRatePerHour: 0, entries: {}, signatureByPeriod: {} };
}

function makeDefaultEntry(dateISO: string, defaultRatePerHour: number): DayEntry {
  return {
    dateISO,
    workType: "Offshore Night Shift (SOV)",
    hours: 0,
    ratePerHour: clampNum(defaultRatePerHour, 0),
    location: "",
    serviceWorker: "",
    platformType: "SOV",
    vesselPreset: "Blue Tern",
    vesselManual: "Blue Tern",
    workNote: "",
    expenses: [],
  };
}

function generateMonthlyPeriods(fromYear = 2025, toYear = 2050): Period[] {
  const start = new Date(fromYear, 0, 1);
  const end = new Date(toYear, 11, 1);
  const out: Period[] = [];
  let cur = startOfMonth(start);

  while (cur <= end) {
    const s = startOfMonth(cur);
    const e = endOfMonth(cur);
    const id = format(cur, "yyyy-MM");
    out.push({
      id,
      label: `${format(cur, "yyyy")} - ${format(cur, "MMMM")}`,
      startISO: format(s, "yyyy-MM-dd"),
      endISO: format(e, "yyyy-MM-dd"),
      invoiceDateISO: format(e, "yyyy-MM-dd"),
    });
    cur = addMonths(cur, 1);
  }
  return out;
}

/** ===================== STORAGE ===================== */

const DEFAULT_STATE: AppState = {
  loginEmail: "",
  selectedPeriodId: format(new Date(), "yyyy-MM"),
  selectedDateISO: todayISO(),
  lockedPeriodIds: [],
  multiMode: false,
  multiSelectedISOs: [],
  users: {},
};

function loadState(): AppState {
  const s = safeParse<AppState>(localStorage.getItem(LS_KEY), DEFAULT_STATE);
  return {
    ...DEFAULT_STATE,
    ...s,
    lockedPeriodIds: Array.isArray(s.lockedPeriodIds) ? s.lockedPeriodIds : [],
    multiMode: !!s.multiMode,
    multiSelectedISOs: Array.isArray(s.multiSelectedISOs) ? s.multiSelectedISOs : [],
    users: s.users || {},
  };
}
function saveState(s: AppState) {
  localStorage.setItem(LS_KEY, JSON.stringify(s));
}

/** ===================== STYLES (APP) ===================== */

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
const btnDark: React.CSSProperties = {
  padding: "12px 14px",
  borderRadius: 12,
  border: "1px solid #ddd",
  background: "#111",
  color: "white",
  fontWeight: 900,
  cursor: "pointer",
  whiteSpace: "nowrap",
};

/** ===================== STYLES (PDF) ===================== */
/** ✅ Made fonts smaller + added "WindPro Timesheet MCE" */

const pdfBox: React.CSSProperties = {
  border: "1px solid #eee",
  borderRadius: 10,
  padding: 16,
  background: "white",
};

const pdfH1: React.CSSProperties = {
  fontSize: 34, // smaller
  fontWeight: 900,
  margin: "0 0 6px 0",
};

const pdfSub: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 700,
  opacity: 0.8,
  margin: "0 0 14px 0",
};

const pdfTitle: React.CSSProperties = {
  fontSize: 22, // smaller
  fontWeight: 900,
  margin: "18px 0 10px",
};

const pdfTh: React.CSSProperties = {
  border: "1px solid #e5e5e5",
  padding: "8px 8px",
  textAlign: "left",
  fontWeight: 800,
  background: "#f5f6f8",
  fontSize: 12, // smaller
};

const pdfTd: React.CSSProperties = {
  border: "1px solid #e5e5e5",
  padding: "8px 8px",
  verticalAlign: "top",
  fontSize: 12, // smaller
};

/** ===================== UI COMPONENTS ===================== */

function Card({ title, big, children }: { title: string; big: string; children?: React.ReactNode }) {
  return (
    <div style={{ border: "1px solid #eee", background: "white", borderRadius: 14, padding: 16 }}>
      <div style={{ opacity: 0.75, marginBottom: 6 }}>{title}</div>
      <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 8 }}>{big}</div>
      <div style={{ opacity: 0.85 }}>{children}</div>
    </div>
  );
}

function Modal({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div
      onMouseDown={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        zIndex: 9999,
      }}
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          width: "min(920px, 100%)",
          background: "white",
          borderRadius: 14,
          border: "1px solid #eee",
          boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
          overflow: "hidden",
        }}
      >
        <div style={{ padding: 14, borderBottom: "1px solid #eee", display: "flex", justifyContent: "space-between" }}>
          <div style={{ fontWeight: 900 }}>{title}</div>
          <button style={smallBtn} onClick={onClose}>
            ✕
          </button>
        </div>
        <div style={{ padding: 14 }}>{children}</div>
      </div>
    </div>
  );
}

/** ===================== APP ===================== */

export default function App() {
  const periods = useMemo(() => generateMonthlyPeriods(2025, 2050), []);
  const [state, setState] = useState<AppState>(() => loadState());
  useEffect(() => saveState(state), [state]);

  const [submitMenuOpen, setSubmitMenuOpen] = useState(false);
  const [copyMyDayOpen, setCopyMyDayOpen] = useState(false);
  const [copyColleagueOpen, setCopyColleagueOpen] = useState(false);
  const [colleagueCode, setColleagueCode] = useState("");
  const [submitBusy, setSubmitBusy] = useState(false);
  const [submitMsg, setSubmitMsg] = useState("");

  const selectedPeriod = useMemo(
    () => periods.find((p) => p.id === state.selectedPeriodId) || periods[0],
    [periods, state.selectedPeriodId]
  );

  const isLocked = useMemo(
    () => state.lockedPeriodIds.includes(selectedPeriod.id),
    [state.lockedPeriodIds, selectedPeriod.id]
  );

  const activeEmail = useMemo(() => normalizeEmail(state.loginEmail), [state.loginEmail]);

  const activeUser = useMemo<StoredUser>(() => {
    if (!activeEmail) return makeDefaultUser();
    return state.users[activeEmail] || makeDefaultUser();
  }, [state.users, activeEmail]);

  useEffect(() => {
    if (!activeEmail) return;
    setState((prev) => {
      if (prev.users[activeEmail]) return prev;
      return { ...prev, users: { ...prev.users, [activeEmail]: makeDefaultUser() } };
    });
  }, [activeEmail]);

  // keep selectedDate inside period
  useEffect(() => {
    if (!inRangeISO(state.selectedDateISO, selectedPeriod.startISO, selectedPeriod.endISO)) {
      setState((p) => ({ ...p, selectedDateISO: selectedPeriod.startISO, multiSelectedISOs: [] }));
    }
  }, [selectedPeriod.id, selectedPeriod.startISO, selectedPeriod.endISO, state.selectedDateISO]);

  const entries = activeUser.entries || {};

  /** ✅ currentEntry now contains ratePerHour per day (not global) */
  const currentEntry: DayEntry = useMemo(() => {
    const e = entries[state.selectedDateISO];
    if (e) return e;
    return makeDefaultEntry(state.selectedDateISO, activeUser.defaultRatePerHour);
  }, [entries, state.selectedDateISO, activeUser.defaultRatePerHour]);

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
      const existing = u.entries[prev.selectedDateISO] || makeDefaultEntry(prev.selectedDateISO, u.defaultRatePerHour);
      const nextEntry: DayEntry = { ...existing, ...patch, dateISO: prev.selectedDateISO };
      return {
        ...prev,
        users: { ...prev.users, [activeEmail]: { ...u, entries: { ...u.entries, [prev.selectedDateISO]: nextEntry } } },
      };
    });
  };

  const clearDay = () => {
    if (!activeEmail || isLocked) return;
    setState((prev) => {
      const u = prev.users[activeEmail] || makeDefaultUser();
      const next = { ...u.entries };
      delete next[prev.selectedDateISO];
      return { ...prev, users: { ...prev.users, [activeEmail]: { ...u, entries: next } } };
    });
  };

  /** ===== Calendar month ===== */
  const monthStart = useMemo(() => startOfMonth(parseISO(selectedPeriod.startISO)), [selectedPeriod.startISO]);
  const monthLabel = useMemo(() => format(monthStart, "MMMM yyyy"), [monthStart]);

  const days = useMemo(() => {
    const count = getDaysInMonth(monthStart);
    const firstDay = monthStart.getDay();
    const cells: { date: Date | null; iso?: string }[] = [];
    for (let i = 0; i < firstDay; i++) cells.push({ date: null });
    for (let d = 1; d <= count; d++) {
      const dt = new Date(monthStart.getFullYear(), monthStart.getMonth(), d);
      const iso = format(dt, "yyyy-MM-dd");
      cells.push({ date: dt, iso });
    }
    while (cells.length % 7 !== 0) cells.push({ date: null });
    return cells;
  }, [monthStart]);

  const savedDatesInMonth = useMemo(() => {
    const monthStr = format(monthStart, "yyyy-MM");
    return new Set(Object.keys(entries).filter((d) => d.startsWith(monthStr)));
  }, [entries, monthStart]);

  /** ===== Period entries + totals ===== */
  const periodEntries = useMemo(() => {
    const out: DayEntry[] = [];
    for (const [dateISO, entry] of Object.entries(entries)) {
      if (inRangeISO(dateISO, selectedPeriod.startISO, selectedPeriod.endISO)) out.push(entry);
    }
    out.sort((a, b) => (a.dateISO < b.dateISO ? -1 : 1));
    return out;
  }, [entries, selectedPeriod.startISO, selectedPeriod.endISO]);

  /** ✅ totals pay is sum(hours * dayRate) */
  const totals = useMemo(() => {
    const hours = periodEntries.reduce((acc, e) => acc + clampNum(e.hours, 0), 0);
    const expenses = periodEntries.reduce((acc, e) => {
      const s = (e.expenses || []).reduce((a, x) => a + clampNum(x.amount, 0), 0);
      return acc + s;
    }, 0);
    const pay = periodEntries.reduce((acc, e) => acc + clampNum(e.hours, 0) * clampNum(e.ratePerHour, 0), 0);

    // “Rate” in cards will show default only (optional, not used in calc)
    const defaultRate = clampNum(activeUser.defaultRatePerHour, 0);

    return {
      hours: round2(hours),
      expenses: round2(expenses),
      pay: round2(pay),
      defaultRate: round2(defaultRate),
    };
  }, [periodEntries, activeUser.defaultRatePerHour]);

  /** ===== Multi-select ===== */
  const multiSet = useMemo(() => new Set(state.multiSelectedISOs), [state.multiSelectedISOs]);
  const toggleMultiISO = (iso: string) => {
    setState((p) => {
      const set = new Set(p.multiSelectedISOs);
      if (set.has(iso)) set.delete(iso);
      else set.add(iso);
      return { ...p, multiSelectedISOs: Array.from(set) };
    });
  };
  const clearMultiSelection = () => setState((p) => ({ ...p, multiSelectedISOs: [] }));

  const onCalendarPick = (iso: string) => {
    if (state.multiMode) toggleMultiISO(iso);
    else setState((p) => ({ ...p, selectedDateISO: iso }));
  };

  /** ===== Expenses ===== */
  const addExpense = () => {
    if (!activeEmail || isLocked) return;
    const next = [...(currentEntry.expenses || []), { id: uid("exp"), type: "Taxi", amount: 0, note: "" }];
    setEntry({ expenses: next });
  };
  const updateExpense = (id: string, patch: Partial<Expense>) => {
    if (!activeEmail || isLocked) return;
    const next = (currentEntry.expenses || []).map((e) => (e.id === id ? { ...e, ...patch } : e));
    setEntry({ expenses: next });
  };
  const removeExpense = (id: string) => {
    if (!activeEmail || isLocked) return;
    const next = (currentEntry.expenses || []).filter((e) => e.id !== id);
    setEntry({ expenses: next });
  };

  const dayExpenseSum = useMemo(() => {
    return round2((currentEntry.expenses || []).reduce((a, x) => a + clampNum(x.amount, 0), 0));
  }, [currentEntry.expenses]);

  const dayPay = useMemo(() => {
    return round2(clampNum(currentEntry.hours, 0) * clampNum(currentEntry.ratePerHour, 0));
  }, [currentEntry.hours, currentEntry.ratePerHour]);

  /** ===== Signature per period ===== */
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);

  const activePeriodSig = useMemo(() => {
    return activeUser.signatureByPeriod?.[selectedPeriod.id] || null;
  }, [activeUser.signatureByPeriod, selectedPeriod.id]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (activePeriodSig) {
      const img = new Image();
      img.onload = () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      };
      img.src = activePeriodSig;
    }
  }, [activePeriodSig, selectedPeriod.id, activeEmail]);

  const sigDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!activeEmail || isLocked) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    drawing.current = true;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const r = canvas.getBoundingClientRect();
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(e.clientX - r.left, e.clientY - r.top);
  };
  const sigMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const r = canvas.getBoundingClientRect();
    ctx.lineTo(e.clientX - r.left, e.clientY - r.top);
    ctx.stroke();
  };
  const sigUp = () => {
    drawing.current = false;
  };

  const signatureSave = () => {
    if (!activeEmail || isLocked) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dataUrl = canvas.toDataURL("image/png");
    const nextMap = { ...(activeUser.signatureByPeriod || {}), [selectedPeriod.id]: dataUrl };
    setUserPatch({ signatureByPeriod: nextMap });
  };

  const signatureClear = () => {
    if (!activeEmail || isLocked) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const nextMap = { ...(activeUser.signatureByPeriod || {}), [selectedPeriod.id]: null };
    setUserPatch({ signatureByPeriod: nextMap });
  };

  /** ===== Lock / Unlock ===== */
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

  /** ===== Submit (LOCK only for now) ===== */
  const submitEmailAndLock = async () => {
    if (!activeEmail) return alert("Bagă Login email.");
    if (!trim1(activeUser.name)) return alert("Bagă Name.");
    if (isLocked) return alert("Perioada este deja locked.");

    setSubmitBusy(true);
    setSubmitMsg("");

    try {
      lockPeriod();
      await new Promise((r) => setTimeout(r, 250));
      setSubmitMsg("✅ Submitted & locked.");
    } catch {
      setSubmitMsg("❌ Submit failed.");
    } finally {
      setSubmitBusy(false);
      setSubmitMenuOpen(false);
    }
  };

  /** ===== Copy my day ===== */
  const applyCopyMyDay = () => {
    if (!activeEmail) return alert("Bagă Login email.");
    if (isLocked) return alert("Perioada e locked.");
    if (state.multiSelectedISOs.length === 0) return alert("Selectează zilele target (multi-select).");

    const sourceISO = state.selectedDateISO;
    const sourceEntry = entries[sourceISO];
    if (!sourceEntry) return alert("Ziua sursă nu are date.");

    const targets = state.multiSelectedISOs.filter(
      (d) => inRangeISO(d, selectedPeriod.startISO, selectedPeriod.endISO) && d !== sourceISO
    );
    if (targets.length === 0) return alert("Nu ai zile target valide.");

    setState((prev) => {
      const u = prev.users[activeEmail] || makeDefaultUser();
      const next = { ...u.entries };
      for (const t of targets) next[t] = { ...sourceEntry, dateISO: t };
      return { ...prev, users: { ...prev.users, [activeEmail]: { ...u, entries: next } } };
    });

    setCopyMyDayOpen(false);
  };

  /** ===== Copy colleague (code) ===== */
  const generateMyDayCode = () => {
    const e = entries[state.selectedDateISO];
    if (!e) return alert("Nu ai nimic salvat pe ziua selectată.");
    const payload = { v: 1, type: "dayEntry", entry: e };
    const code = JSON.stringify(payload);
    setColleagueCode(code);
    try {
      void navigator.clipboard?.writeText(code);
    } catch {}
    alert("Cod generat (și copiat dacă browserul permite). Trimite-l colegului.");
  };

  const importColleagueAndApply = () => {
    if (!activeEmail) return alert("Bagă Login email.");
    if (isLocked) return alert("Perioada e locked.");
    if (state.multiSelectedISOs.length === 0) return alert("Selectează zilele target (multi-select).");

    let parsed: any;
    try {
      parsed = JSON.parse(colleagueCode);
    } catch {
      return alert("Cod invalid (nu e JSON).");
    }
    if (!parsed || parsed.v !== 1 || parsed.type !== "dayEntry" || !parsed.entry) return alert("Cod invalid.");

    const entry: DayEntry = parsed.entry;
    const targets = state.multiSelectedISOs.filter((d) => inRangeISO(d, selectedPeriod.startISO, selectedPeriod.endISO));
    if (targets.length === 0) return alert("Nu ai zile target valide.");

    setState((prev) => {
      const u = prev.users[activeEmail] || makeDefaultUser();
      const next = { ...u.entries };
      for (const t of targets) next[t] = { ...entry, dateISO: t };
      return { ...prev, users: { ...prev.users, [activeEmail]: { ...u, entries: next } } };
    });

    setCopyColleagueOpen(false);
  };

  /** ===== PDF Export ===== */
  const exportPdfPeriod = async () => {
    if (!activeEmail) return alert("Bagă Login email.");
    const root = document.getElementById("pdf-root");
    if (!root) return alert("PDF template missing (#pdf-root).");

    await new Promise((r) => setTimeout(r, 50));

    const canvas = await html2canvas(root, {
      scale: 2,
      backgroundColor: "#ffffff",
      useCORS: true,
      logging: false,
    });

    const imgData = canvas.toDataURL("image/png");
    const pdf = new jsPDF("p", "pt", "a4");

    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();

    const imgWidth = pageWidth;
    const imgHeight = (canvas.height * imgWidth) / canvas.width;

    let remaining = imgHeight;
    let y = 0;

    pdf.addImage(imgData, "PNG", 0, y, imgWidth, imgHeight);
    remaining -= pageHeight;

    while (remaining > 0) {
      pdf.addPage();
      y = -(imgHeight - remaining);
      pdf.addImage(imgData, "PNG", 0, y, imgWidth, imgHeight);
      remaining -= pageHeight;
    }

    pdf.save(`Timesheet_${selectedPeriod.id}_${activeEmail}.pdf`);
  };

  const generatedStr = useMemo(() => format(new Date(), "MM/dd/yyyy, h:mm a"), [state.selectedPeriodId]);

  return (
    <div style={{ maxWidth: 1280, margin: "0 auto", padding: 18, fontFamily: "Georgia, 'Times New Roman', serif" }}>
      <h1 style={{ margin: "0 0 4px 0" }}>WindPro TimeSheet</h1>
      <div style={{ opacity: 0.7, marginBottom: 12 }}>
        PDF pe perioada selectată. Submit = lock. Copy = multi-select. Unlock = admin.
      </div>

      {/* TOP BAR */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "520px 1fr auto",
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
            onChange={(e) => {
              const pid = e.target.value;
              setState((p) => ({ ...p, selectedPeriodId: pid, selectedDateISO: `${pid}-01`, multiSelectedISOs: [] }));
            }}
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
        <div style={{ display: "flex", gap: 10, justifySelf: "end", alignItems: "center" }}>
          <button onClick={exportPdfPeriod} style={btnBlue} disabled={!activeEmail}>
            Export PDF (Period)
          </button>

          {/* SUBMIT DROPDOWN */}
          <div style={{ position: "relative" }}>
            <button onClick={() => setSubmitMenuOpen((v) => !v)} style={btnGreen} disabled={!activeEmail || submitBusy}>
              Submit ▾
            </button>

            {submitMenuOpen && (
              <div
                style={{
                  position: "absolute",
                  right: 0,
                  top: "110%",
                  width: 280,
                  background: "white",
                  border: "1px solid #eee",
                  borderRadius: 12,
                  boxShadow: "0 14px 40px rgba(0,0,0,0.18)",
                  overflow: "hidden",
                  zIndex: 9999,
                }}
              >
                <button
                  style={{ ...smallBtn, width: "100%", border: "none", borderRadius: 0, textAlign: "left" }}
                  disabled={!activeEmail || isLocked || submitBusy}
                  onClick={submitEmailAndLock}
                >
                  Submit (lock period)
                </button>

                <button
                  style={{ ...smallBtn, width: "100%", border: "none", borderRadius: 0, textAlign: "left" }}
                  disabled={!activeEmail || isLocked}
                  onClick={() => {
                    setSubmitMenuOpen(false);
                    setState((p) => ({ ...p, multiMode: true }));
                    setCopyMyDayOpen(true);
                  }}
                >
                  Copy my day (multi-select)
                </button>

                <button
                  style={{ ...smallBtn, width: "100%", border: "none", borderRadius: 0, textAlign: "left" }}
                  disabled={!activeEmail || isLocked}
                  onClick={() => {
                    setSubmitMenuOpen(false);
                    setState((p) => ({ ...p, multiMode: true }));
                    setCopyColleagueOpen(true);
                  }}
                >
                  Copy my colleague (code)
                </button>
              </div>
            )}
          </div>

          <button onClick={unlockAdmin} style={{ ...smallBtn, borderColor: "#f0bcbc", color: "#b55" }}>
            Unlock (Admin)
          </button>
        </div>
      </div>

      {submitMsg ? (
        <div style={{ marginTop: 10, padding: 10, borderRadius: 12, border: "1px solid #eee", background: "white" }}>
          {submitMsg}
        </div>
      ) : null}

      {/* CARDS */}
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
          <div style={{ opacity: 0.8 }}>
            Default rate: € {totals.defaultRate.toFixed(2)} / h (optional)
          </div>
        </Card>
      </div>

      {/* MAIN */}
      <div style={{ display: "grid", gridTemplateColumns: "420px 1fr", gap: 16, marginTop: 16 }}>
        {/* LEFT */}
        <div style={{ borderRadius: 14, border: "1px solid #eee", padding: 16, background: "white" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <div style={{ fontSize: 24, fontWeight: 700 }}>{monthLabel}</div>
            <div style={{ opacity: 0.7 }}>Select days</div>
          </div>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 10 }}>
            <label style={{ display: "flex", gap: 10, alignItems: "center", fontWeight: 800 }}>
              <input
                type="checkbox"
                checked={state.multiMode}
                onChange={(e) => setState((p) => ({ ...p, multiMode: e.target.checked, multiSelectedISOs: [] }))}
              />
              Multi-select days
            </label>

            {state.multiMode ? (
              <button onClick={clearMultiSelection} style={smallBtn}>
                Clear selection ({state.multiSelectedISOs.length})
              </button>
            ) : null}
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
              const isMultiSelected = multiSet.has(iso);
              const saved = savedDatesInMonth.has(iso);

              return (
                <button
                  key={iso}
                  onClick={() => onCalendarPick(iso)}
                  style={{
                    height: 44,
                    borderRadius: 999,
                    border: isSelectedDay ? "3px solid #1f5eff" : isMultiSelected ? "3px solid #111" : "1px solid transparent",
                    background: isMultiSelected ? "#111" : "white",
                    color: isMultiSelected ? "white" : "black",
                    cursor: "pointer",
                    position: "relative",
                    fontWeight: 700,
                  }}
                  title={saved ? "Saved day" : ""}
                >
                  {format(cell.date, "d")}
                  {saved ? (
                    <span
                      style={{
                        position: "absolute",
                        bottom: 6,
                        left: "50%",
                        transform: "translateX(-50%)",
                        width: 6,
                        height: 6,
                        borderRadius: 999,
                        background: isMultiSelected ? "white" : "#1f5eff",
                      }}
                    />
                  ) : null}
                </button>
              );
            })}
          </div>

          <div style={{ marginTop: 18 }}>
            <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 10 }}>Signature (per period)</div>

            <div style={{ display: "flex", gap: 10, marginBottom: 8 }}>
              <button onClick={signatureSave} style={smallBtn} disabled={!activeEmail || isLocked}>
                Save
              </button>
              <button onClick={signatureClear} style={smallBtn} disabled={!activeEmail || isLocked}>
                Clear
              </button>
            </div>

            <canvas
              width={360}
              height={150}
              ref={canvasRef}
              onPointerDown={sigDown}
              onPointerMove={sigMove}
              onPointerUp={sigUp}
              onPointerLeave={sigUp}
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

        {/* RIGHT */}
        <div style={{ borderRadius: 14, border: "1px solid #eee", padding: 16, background: "white" }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
            <div>
              <div style={{ fontSize: 28, fontWeight: 800 }}>
                {format(parseISO(state.selectedDateISO), "EEEE, MMMM dd, yyyy")}
              </div>
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
                <div style={lbl}>Payment rate (€ / hour) (per day)</div>
                <input
                  value={currentEntry.ratePerHour}
                  disabled={!activeEmail || isLocked}
                  onChange={(e) => setEntry({ ratePerHour: clampNum(e.target.value, 0) })}
                  type="number"
                  min={0}
                  step="0.01"
                  style={{ ...input, padding: 10 }}
                  placeholder="ex: 44"
                />
              </label>
            </div>

            <div style={{ marginTop: 10, opacity: 0.8 }}>
              Day pay: <b>€ {dayPay.toFixed(2)}</b> | Day expenses: <b>€ {dayExpenseSum.toFixed(2)}</b>
            </div>

            {/* Optional default rate */}
            <div style={{ marginTop: 10, padding: 12, borderRadius: 12, border: "1px solid #eee", background: "#fafafa" }}>
              <div style={{ fontWeight: 800, marginBottom: 6 }}>Default rate (optional)</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 220px", gap: 12, alignItems: "end" }}>
                <div style={{ opacity: 0.8 }}>
                  Setează o rată default ca să se pre-completeze automat pentru zilele noi.
                </div>
                <input
                  value={activeUser.defaultRatePerHour}
                  disabled={!activeEmail}
                  onChange={(e) => setUserPatch({ defaultRatePerHour: clampNum(e.target.value, 0) })}
                  type="number"
                  min={0}
                  step="0.01"
                  style={{ ...input, padding: 10 }}
                  placeholder="ex: 44"
                />
              </div>
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

            {/* Vessel / Platform */}
            <div style={{ marginTop: 14, padding: 14, borderRadius: 14, border: "1px solid #eee" }}>
              <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 10 }}>Vessel / Platform</div>

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

                <label>
                  <div style={lbl}>Vessel (preset)</div>
                  <select
                    value={currentEntry.vesselPreset}
                    disabled={!activeEmail || isLocked}
                    onChange={(e) => {
                      const v = e.target.value;
                      setEntry({ vesselPreset: v, vesselManual: v });
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
              </div>

              <label style={{ display: "block", marginTop: 12 }}>
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

            {/* Work note */}
            <label style={{ display: "block", marginTop: 14 }}>
              <div style={lbl}>Work note</div>
              <input
                value={currentEntry.workNote}
                disabled={!activeEmail || isLocked}
                onChange={(e) => setEntry({ workNote: e.target.value })}
                placeholder="ex: main component / torque / HV test..."
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
                    style={{ display: "grid", gridTemplateColumns: "220px 140px 1fr 80px", gap: 10, alignItems: "center" }}
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
            </div>

            {isLocked ? (
              <div style={{ marginTop: 16, padding: 12, borderRadius: 12, border: "1px solid #f0bcbc", color: "#b55" }}>
                This month is locked. Use Unlock (Admin) to edit.
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {/* COPY MY DAY MODAL */}
      <Modal open={copyMyDayOpen} title="Copy my day (multi-select)" onClose={() => setCopyMyDayOpen(false)}>
        <div style={{ display: "grid", gap: 12 }}>
          <div style={{ opacity: 0.85 }}>
            Ziua sursă = <b>{state.selectedDateISO}</b>. Target = zilele bifate în calendar (multi-select).
          </div>
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button style={smallBtn} onClick={() => setCopyMyDayOpen(false)}>
              Cancel
            </button>
            <button style={btnDark} onClick={applyCopyMyDay} disabled={isLocked}>
              Apply to selected days ({state.multiSelectedISOs.length})
            </button>
          </div>
        </div>
      </Modal>

      {/* COPY COLLEAGUE MODAL */}
      <Modal open={copyColleagueOpen} title="Copy my colleague (code)" onClose={() => setCopyColleagueOpen(false)}>
        <div style={{ display: "grid", gap: 12 }}>
          <div style={{ opacity: 0.85 }}>
            1) Generezi cod din ziua ta selectată (sau lipești cod de la coleg). 2) Îl aplici peste zilele bifate.
          </div>

          <button style={btnBlue} onClick={generateMyDayCode} disabled={!activeEmail}>
            Generate code from my selected day
          </button>

          <textarea
            value={colleagueCode}
            onChange={(e) => setColleagueCode(e.target.value)}
            placeholder='{"v":1,"type":"dayEntry","entry":{...}}'
            style={{ ...input, minHeight: 160, resize: "vertical" }}
          />

          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button style={smallBtn} onClick={() => setCopyColleagueOpen(false)}>
              Cancel
            </button>
            <button style={btnDark} onClick={importColleagueAndApply} disabled={isLocked}>
              Import & apply to selected days ({state.multiSelectedISOs.length})
            </button>
          </div>
        </div>
      </Modal>

      {/* ===================== PDF TEMPLATE (HIDDEN) ===================== */}
      <div style={{ position: "absolute", left: -99999, top: 0, width: 900 }}>
        <div
          id="pdf-root"
          style={{
            width: 900,
            padding: 26,
            fontFamily: "Arial, Helvetica, sans-serif",
            color: "#111",
            background: "white",
          }}
        >
          {/* ✅ Title + MCE */}
          <div style={pdfH1}>Timesheet</div>
          <div style={pdfSub}>WindPro Timesheet MCE</div>

          <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 16 }}>
            {/* Left box */}
            <div style={pdfBox}>
              <div style={{ fontSize: 16, lineHeight: 1.8 }}>
                <div>
                  <span style={{ opacity: 0.75 }}>Period:</span> {selectedPeriod.label}
                </div>
                <div>
                  <span style={{ opacity: 0.75 }}>Invoice date:</span> {selectedPeriod.invoiceDateISO}
                </div>
                <div>
                  <span style={{ opacity: 0.75 }}>Submitted by:</span> {activeEmail || "-"}
                </div>
                <div>
                  <span style={{ opacity: 0.75 }}>Name:</span> {activeUser.name || "-"}
                </div>
              </div>
            </div>

            {/* Right box */}
            <div style={pdfBox}>
              <div style={{ fontSize: 18, fontWeight: 900, lineHeight: 1.8 }}>
                <div>Total hours: {(Number(totals.hours) || 0).toFixed(2)}</div>
                <div>Total expenses: € {(Number(totals.expenses) || 0).toFixed(2)}</div>
                <div>Total pay: € {(Number(totals.pay) || 0).toFixed(2)}</div>
              </div>

              <div style={{ marginTop: 14, fontSize: 12, opacity: 0.85 }}>
                Generated: {generatedStr}
              </div>
            </div>
          </div>

          <div style={pdfTitle}>Entries (Selected Period)</div>

          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={pdfTh}>Date</th>
                <th style={pdfTh}>Day</th>
                <th style={pdfTh}>Work type</th>
                <th style={pdfTh}>Vessel</th>
                <th style={pdfTh}>Location</th>
                <th style={pdfTh}>Hours</th>
                <th style={pdfTh}>Rate</th>
                <th style={pdfTh}>Pay</th>
                <th style={pdfTh}>SW</th>
                <th style={pdfTh}>Expenses</th>
                <th style={pdfTh}>Work note</th>
              </tr>
            </thead>

            <tbody>
              {periodEntries.map((e) => {
                const rate = Number(e.ratePerHour) || 0; // ✅ per-day rate
                const hours = Number(e.hours) || 0;
                const pay = hours * rate;
                const expSum = (e.expenses || []).reduce((a, x) => a + (Number(x.amount) || 0), 0);
                const vessel = (e.vesselManual || e.vesselPreset || "").trim();
                const dayNum = parseISO(e.dateISO).getDate();

                return (
                  <tr key={e.dateISO}>
                    <td style={pdfTd}>{e.dateISO}</td>
                    <td style={pdfTd}>{dayNum}</td>
                    <td style={pdfTd}>{e.workType}</td>
                    <td style={pdfTd}>{vessel}</td>
                    <td style={pdfTd}>{e.location}</td>
                    <td style={pdfTd}>{hours.toFixed(2)}</td>
                    <td style={pdfTd}>€ {rate.toFixed(2)}</td>
                    <td style={pdfTd}>€ {pay.toFixed(2)}</td>
                    <td style={pdfTd}>{e.serviceWorker}</td>
                    <td style={pdfTd}>€ {expSum.toFixed(2)}</td>
                    <td style={pdfTd}>{e.workNote}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 18, alignItems: "start" }}>
            <div>
              <div style={{ fontSize: 22, fontWeight: 900, marginBottom: 10 }}>Totals</div>
              <div style={{ fontSize: 14, lineHeight: 1.8 }}>
                <div>Hours: {(Number(totals.hours) || 0).toFixed(2)}</div>
                <div>Expenses: € {(Number(totals.expenses) || 0).toFixed(2)}</div>
                <div>Pay: € {(Number(totals.pay) || 0).toFixed(2)}</div>
              </div>
            </div>

            <div>
              <div style={{ fontSize: 22, fontWeight: 900, marginBottom: 10 }}>Signature</div>
              <div style={{ border: "1px solid #eee", borderRadius: 10, height: 170, overflow: "hidden" }}>
                {activePeriodSig ? (
                  <img src={activePeriodSig} alt="signature" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </div>
      {/* ===================== END PDF TEMPLATE ===================== */}
    </div>
  );
}
