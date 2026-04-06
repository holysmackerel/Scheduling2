
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  Clock,
  CheckCircle2,
  XCircle,
  AlertCircle,
  History as HistoryIcon,
  LogOut,
  Plus,
  Minus,
  Undo2,
  StickyNote,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { loadInitialData, persistData } from "./lib/persistence";
import { supabase } from "./lib/supabase";

const DAYS_HDR = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const TIMES = ["None"];
for (let h = 7; h <= 21; h++) {
  for (let m = 0; m < 60; m += 15) {
    const hr = h > 12 ? h - 12 : h === 0 ? 12 : h;
    TIMES.push(`${hr}:${m.toString().padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`);
  }
}

const DEFAULT_THEME = {
  collin: { primary: "#34d399", bg: "#ecfdf5", text: "#064e3b", border: "#a7f3d0" },
  tiia: { primary: "#60a5fa", bg: "#eff6ff", text: "#1e3a8a", border: "#bfdbfe" },
};

const EVENTS: Record<string, { t: string; tm: string; w?: string }[]> = {
  "2026-03-30": [{ t: "Julia swim class", tm: "4:00 PM" }],
  "2026-04-01": [{ t: "Team standup", tm: "9:00 AM", w: "collin" }],
  "2026-04-02": [{ t: "Parent-teacher", tm: "3:30 PM" }, { t: "Yoga", tm: "6:00 PM", w: "tiia" }],
  "2026-04-03": [{ t: "Dentist (Julia)", tm: "2:00 PM", w: "tiia" }],
  "2026-04-04": [{ t: "Date night", tm: "7:30 PM", w: "collin" }],
  "2026-04-05": [{ t: "Julia birthday party", tm: "11:00 AM" }],
  "2026-04-07": [{ t: "Gym", tm: "6:30 AM", w: "collin" }],
  "2026-04-09": [{ t: "Client dinner", tm: "7:00 PM", w: "collin" }, { t: "Yoga", tm: "6:00 PM", w: "tiia" }],
  "2026-04-10": [{ t: "Work drinks", tm: "5:30 PM", w: "tiia" }],
  "2026-04-12": [{ t: "Julia swim comp", tm: "9:00 AM" }],
  "2026-04-13": [{ t: "Julia piano", tm: "4:00 PM" }],
  "2026-04-15": [{ t: "Dentist", tm: "2:00 PM", w: "collin" }],
  "2026-04-16": [{ t: "School play", tm: "6:00 PM" }],
};

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}
function fmt(d: Date) {
  return d.toISOString().split("T")[0];
}
function fmtDay(d: Date) {
  if (isNaN(d.getTime())) return "Invalid Date";
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}
function dow(d: Date) {
  return (d.getDay() + 6) % 7;
}
function addD(d: Date, n: number) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}
function weekStart(d: Date) {
  const r = new Date(d);
  r.setDate(r.getDate() - dow(r));
  return r;
}
function todayAtNoon() {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  return d;
}

function initSchedule() {
  const s: Record<string, any> = {};
  const pat = [0, 0, 1, 1, 0, 0, 1];
  let d = new Date("2026-03-01");
  const end = new Date("2026-06-01");
  while (d < end) {
    const k = fmt(d);
    const di = dow(d);
    s[k] = { night: pat[di] === 0 ? "collin" : "tiia", pickup: "None", daycare: di <= 4, note: "" };
    d = addD(d, 1);
  }
  s["2026-04-05"].note = "Julia's friend Mia's birthday party at 11am";
  s["2026-04-12"].note = "Swim competition - bring goggles + towel";
  s["2026-04-16"].note = "School play at 6pm, both attending";
  return s;
}

function seedData() {
  return {
    schedule: initSchedule(),
    proposals: [],
  };
}

const STORE_KEY = "coparent-v5";
const COLLIN_EMAIL = (import.meta.env.VITE_COLLIN_EMAIL as string | undefined)?.toLowerCase();
const TIIA_EMAIL = (import.meta.env.VITE_TIIA_EMAIL as string | undefined)?.toLowerCase();
const AUTH_REDIRECT_URL = (import.meta.env.VITE_AUTH_REDIRECT_URL as string | undefined)?.trim();
const APP_VERSION = __APP_VERSION__;
const BUILD_ID = __BUILD_ID__;
const GIT_SHA = __GIT_SHA__;

function resolveUserFromEmail(email?: string | null): "collin" | "tiia" | null {
  const normalized = email?.toLowerCase();
  if (!normalized) return null;
  if (COLLIN_EMAIL && normalized === COLLIN_EMAIL) return "collin";
  if (TIIA_EMAIL && normalized === TIIA_EMAIL) return "tiia";
  return null;
}

function getAuthRedirectUrl() {
  if (AUTH_REDIRECT_URL) return AUTH_REDIRECT_URL;
  return `${window.location.origin}${window.location.pathname}`;
}

function isRecoveryHash(hash: string) {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  const params = new URLSearchParams(raw);
  return params.get("type") === "recovery";
}

function Pill({ who, theme, small }: { who: "collin" | "tiia"; theme: any; small?: boolean }) {
  const config = theme[who];
  return (
    <span className={`inline-block rounded px-2 py-0.5 font-medium ${small ? "text-[10px]" : "text-[11px]"}`} style={{ backgroundColor: config.bg, color: config.text }}>
      {who === "collin" ? "Collin" : "Tiia"}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    accepted: "bg-emerald-100 text-emerald-700",
    declined: "bg-rose-100 text-rose-700",
    pending: "bg-amber-100 text-amber-700",
    forced: "bg-red-100 text-red-700",
  };
  return <span className={`text-[10px] px-2 py-0.5 rounded font-semibold uppercase tracking-wider ${styles[status] || styles.pending}`}>{status}</span>;
}

function NightToggle({ value, theme, onChange }: { value: "collin" | "tiia"; theme: any; onChange: (v: "collin" | "tiia") => void }) {
  return (
    <div onClick={() => onChange(value === "collin" ? "tiia" : "collin")} className="inline-flex cursor-pointer rounded-lg overflow-hidden border border-slate-200 bg-slate-50">
      <div className={`px-3 py-1 text-[11px] font-bold transition-all ${value === "collin" ? "shadow-sm" : "text-slate-400"}`} style={value === "collin" ? { backgroundColor: theme.collin.primary, color: theme.collin.text } : {}}>C</div>
      <div className={`px-3 py-1 text-[11px] font-bold transition-all ${value === "tiia" ? "shadow-sm" : "text-slate-400"}`} style={value === "tiia" ? { backgroundColor: theme.tiia.primary, color: theme.tiia.text } : {}}>T</div>
    </div>
  );
}

function DaycareToggle({ on, theme, onToggle }: { on: boolean; theme: any; onToggle: () => void }) {
  return (
    <label className="inline-flex items-center gap-2 cursor-pointer select-none">
      <div onClick={(e) => { e.preventDefault(); onToggle(); }} className={`relative w-9 h-5 rounded-full transition-colors ${on ? "" : "bg-slate-300"}`} style={on ? { backgroundColor: theme.collin.primary } : {}}>
        <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-all shadow-sm ${on ? "left-[18px]" : "left-0.5"}`} />
      </div>
      <span className={`text-[11px] font-medium ${on ? "text-slate-900" : "text-slate-400"}`}>Daycare</span>
    </label>
  );
}

function ThemeEditor({ theme, onChange, onSave, onCancel }: { theme: any; onChange: (t: any) => void; onSave: () => void; onCancel: () => void }) {
  const users = ["collin", "tiia"] as const;
  const fields = [{ key: "primary", label: "Accent Color" }, { key: "bg", label: "Background Color" }, { key: "text", label: "Text Color" }] as const;
  return (
    <div className="max-w-2xl mx-auto p-4 sm:p-6 min-h-screen bg-slate-50">
      <div className="flex items-center justify-between mb-8">
        <h2 className="text-2xl font-bold text-slate-900">Theme Editor</h2>
        <div className="flex gap-2">
          <button onClick={onCancel} className="px-4 py-2 text-slate-600 font-bold text-sm hover:bg-slate-100 rounded-xl transition-all">Cancel</button>
          <button onClick={onSave} className="px-6 py-2 bg-blue-500 text-white font-bold text-sm rounded-xl shadow-lg shadow-blue-500/20 hover:bg-blue-600 transition-all">Save Changes</button>
        </div>
      </div>
      <div className="grid gap-6 sm:grid-cols-2">
        {users.map((u) => (
          <div key={u} className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
            <h3 className="text-lg font-bold text-slate-800 capitalize mb-4 flex items-center gap-2"><div className="w-4 h-4 rounded-full" style={{ backgroundColor: theme[u].primary }} />{u}'s Colors</h3>
            <div className="space-y-4">
              {fields.map((f) => (
                <div key={f.key}>
                  <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">{f.label}</label>
                  <div className="flex items-center gap-3">
                    <input type="color" value={theme[u][f.key]} onChange={(e) => onChange({ ...theme, [u]: { ...theme[u], [f.key]: e.target.value } })} className="w-10 h-10 rounded-lg border-0 cursor-pointer p-0 overflow-hidden bg-transparent" />
                    <input type="text" value={theme[u][f.key]} onChange={(e) => onChange({ ...theme, [u]: { ...theme[u], [f.key]: e.target.value } })} className="flex-1 text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 outline-none focus:border-blue-400" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-8 bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4">Live Preview</h3>
        <div className="p-4 rounded-xl border border-slate-100 bg-slate-50 flex flex-wrap gap-4">
          <Pill who="collin" theme={theme} />
          <Pill who="tiia" theme={theme} />
          <div className="flex gap-2"><div className="w-8 h-8 rounded-lg" style={{ backgroundColor: theme.collin.primary }} /><div className="w-8 h-8 rounded-lg" style={{ backgroundColor: theme.tiia.primary }} /></div>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState<"collin" | "tiia" | null>(null);
  const [authEmail, setAuthEmail] = useState<string | null>(null);
  const [authReady, setAuthReady] = useState(!supabase);
  const [emailInput, setEmailInput] = useState("");
  const [passwordInput, setPasswordInput] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [showResetOption, setShowResetOption] = useState(false);
  const [isRecoveryMode, setIsRecoveryMode] = useState(() => isRecoveryHash(window.location.hash));
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [recoveryMessage, setRecoveryMessage] = useState<string | null>(null);
  const [page, setPage] = useState<"main" | "history" | "theme">("main");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [edits, setEdits] = useState<Record<string, any>>({});
  const [noteOpen, setNoteOpen] = useState<string | null>(null);
  const [theme, setTheme] = useState(DEFAULT_THEME);
  const [tempTheme, setTempTheme] = useState(DEFAULT_THEME);
  const buildLabel = useMemo(() => {
    const d = new Date(__BUILD_TIME_ISO__);
    if (isNaN(d.getTime())) return __BUILD_TIME_ISO__;
    return d.toLocaleString("en-GB", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }, []);

  const [todayKey, setTodayKey] = useState(() => fmt(todayAtNoon()));
  const [todayDate, setTodayDate] = useState(() => todayAtNoon());

  useEffect(() => {
    const refresh = () => {
      const next = todayAtNoon();
      setTodayDate(next);
      setTodayKey(fmt(next));
    };
    refresh();
    const interval = window.setInterval(refresh, 60 * 1000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!supabase) return;
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      const email = data.session?.user?.email ?? null;
      setAuthEmail(email);
      setUser(resolveUserFromEmail(email));
      setAuthReady(true);
    });

    const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
      const email = session?.user?.email ?? null;
      setAuthEmail(email);
      setUser(resolveUserFromEmail(email));
      if (event === "PASSWORD_RECOVERY") {
        setIsRecoveryMode(true);
        setRecoveryMessage(null);
      }
      setAuthReady(true);
    });

    return () => {
      mounted = false;
      authListener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    const onHashChange = () => {
      setIsRecoveryMode(isRecoveryHash(window.location.hash));
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const initialStart = useMemo(() => weekStart(todayDate), [todayDate]);
  const initialWeeks = useMemo(() => (dow(todayDate) < 4 ? 2 : 3), [todayDate]);
  const [rangeStart, setRangeStart] = useState(initialStart);
  const [rangeWeeks, setRangeWeeks] = useState(initialWeeks);
  const allDays = useMemo(() => Array.from({ length: rangeWeeks * 7 }, (_, i) => addD(rangeStart, i)), [rangeStart, rangeWeeks]);

  const canRemovePrev = rangeStart.getTime() < initialStart.getTime();
  const canRemoveNext = (rangeStart.getTime() + (rangeWeeks - 1) * 7 * 24 * 60 * 60 * 1000) > initialStart.getTime();

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const parsed = await loadInitialData(STORE_KEY, seedData);
        if (!mounted) return;
        setData(parsed);
        if ((parsed as any)?.theme) {
          setTheme((parsed as any).theme);
          setTempTheme((parsed as any).theme);
        }
      } catch (e) {
        console.error("Failed to load data:", e);
        if (mounted) setData(seedData());
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const save = useCallback((nd: any, nt?: any) => {
    const payload = { ...nd, theme: nt || theme };
    setData(nd);
    if (nt) setTheme(nt);
    void persistData(STORE_KEY, payload);
  }, [theme]);

  const signInWithEmail = useCallback(async () => {
    if (!supabase) return;
    if (!emailInput || !passwordInput) {
      setAuthError("Enter email and password.");
      return;
    }
    setAuthBusy(true);
    setAuthError(null);
    setShowResetOption(false);
    const { error } = await supabase.auth.signInWithPassword({
      email: emailInput.trim(),
      password: passwordInput,
    });
    if (error) {
      setAuthError(error.message);
      setShowResetOption(error.message.toLowerCase().includes("invalid login"));
    }
    setAuthBusy(false);
  }, [emailInput, passwordInput]);

  const signUpWithEmail = useCallback(async () => {
    if (!supabase) return;
    if (!emailInput || !passwordInput) {
      setAuthError("Enter email and password.");
      return;
    }
    setAuthBusy(true);
    setAuthError(null);
    setShowResetOption(false);
    const redirectTo = getAuthRedirectUrl();
    const { data: signUpData, error } = await supabase.auth.signUp({
      email: emailInput.trim(),
      password: passwordInput,
      options: { emailRedirectTo: redirectTo },
    });
    if (error) {
      setAuthError(error.message);
      const msg = error.message.toLowerCase();
      const accountExists = msg.includes("already") || msg.includes("exists") || msg.includes("registered");
      setShowResetOption(accountExists);
    } else {
      // Supabase can return no error for existing users; identities is usually empty in that case.
      const identities = signUpData.user?.identities;
      const looksLikeExistingUser = Array.isArray(identities) && identities.length === 0;
      if (looksLikeExistingUser) {
        setAuthError("Account already exists. Sign in or reset your password.");
        setShowResetOption(true);
      } else {
        setAuthError("Account created. Check your email confirmation if required, then sign in.");
      }
    }
    setAuthBusy(false);
  }, [emailInput, passwordInput]);

  const sendPasswordReset = useCallback(async () => {
    if (!supabase) return;
    if (!emailInput) {
      setAuthError("Enter your email first.");
      return;
    }
    setAuthBusy(true);
    const redirectTo = getAuthRedirectUrl();
    const { error } = await supabase.auth.resetPasswordForEmail(emailInput.trim(), { redirectTo });
    if (error) {
      setAuthError(error.message);
    } else {
      setAuthError("Password reset email sent. Check your inbox.");
      setShowResetOption(false);
    }
    setAuthBusy(false);
  }, [emailInput]);

  const handleLogout = useCallback(async () => {
    if (supabase) {
      await supabase.auth.signOut();
      setAuthEmail(null);
      setEmailInput("");
      setPasswordInput("");
    }
    setUser(null);
  }, []);

  const updatePasswordFromRecovery = useCallback(async () => {
    if (!supabase) return;
    if (!newPassword || newPassword.length < 8) {
      setRecoveryMessage("Password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setRecoveryMessage("Passwords do not match.");
      return;
    }
    setAuthBusy(true);
    setRecoveryMessage(null);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) {
      setRecoveryMessage(error.message);
    } else {
      setRecoveryMessage("Password updated successfully. You can continue.");
      setIsRecoveryMode(false);
      setNewPassword("");
      setConfirmPassword("");
      if (window.location.hash) {
        window.history.replaceState({}, document.title, `${window.location.pathname}${window.location.search}`);
      }
    }
    setAuthBusy(false);
  }, [confirmPassword, newPassword]);

  const handleRespond = (id: string, status: string, response: string) => {
    if (!data || !user) return;
    const props = data.proposals.map((p: any) => (p.id !== id ? p : { ...p, status, response, respondedBy: user, respondedAt: new Date().toISOString() }));
    const sched = { ...data.schedule };
    if (status === "accepted") {
      const prop = data.proposals.find((p: any) => p.id === id);
      if (prop) prop.changes.forEach((c: any) => { sched[c.date] = { ...sched[c.date], night: c.to.night, pickup: c.to.pickup, daycare: c.to.daycare }; });
    }
    save({ ...data, proposals: props, schedule: sched });
  };

  const handleProposal = (proposal: any, noteChanges: Record<string, string>) => {
    if (!data) return;
    const sched = { ...data.schedule };
    Object.keys(noteChanges).forEach((k) => { sched[k] = { ...sched[k], note: noteChanges[k] }; });
    save({ ...data, schedule: sched, proposals: [...data.proposals, proposal] });
    setEdits({});
  };

  const collectProposalChanges = useCallback(() => {
    if (!data) return null;
    const changes = Object.keys(edits).map((k) => {
      const original = data.schedule[k] || { night: "collin", pickup: "5:30 PM", daycare: false, note: "" };
      return {
        date: k,
        was: { night: original.night, pickup: original.pickup, daycare: original.daycare },
        to: { night: edits[k].night, pickup: edits[k].pickup, daycare: edits[k].daycare },
      };
    });
    const noteChanges: Record<string, string> = {};
    Object.keys(edits).forEach((k) => {
      const originalNote = data.schedule[k]?.note || "";
      if (edits[k].note !== originalNote) noteChanges[k] = edits[k].note;
    });
    return { changes, noteChanges };
  }, [data, edits]);

  const handleSendProposal = useCallback(() => {
    if (!user) return;
    const payload = collectProposalChanges();
    if (!payload) return;
    handleProposal({
      id: uid(),
      from: user,
      created: new Date().toISOString(),
      changes: payload.changes,
      note: "",
      status: "pending",
      response: "",
      respondedBy: null,
      respondedAt: null,
    }, payload.noteChanges);
  }, [collectProposalChanges, user]);

  const handleForceProposal = useCallback(() => {
    if (!data || !user) return;
    const payload = collectProposalChanges();
    if (!payload) return;
    const now = new Date().toISOString();
    const sched = { ...data.schedule };
    payload.changes.forEach((c: any) => {
      sched[c.date] = { ...sched[c.date], night: c.to.night, pickup: c.to.pickup, daycare: c.to.daycare };
    });
    Object.keys(payload.noteChanges).forEach((k) => {
      sched[k] = { ...sched[k], note: payload.noteChanges[k] };
    });
    save({
      ...data,
      schedule: sched,
      proposals: [
        ...data.proposals,
        {
          id: uid(),
          from: user,
          created: now,
          changes: payload.changes,
          note: "",
          status: "forced",
          response: "Force proposal applied immediately",
          respondedBy: user,
          respondedAt: now,
          forcedBy: user,
          forcedAt: now,
        },
      ],
    });
    setEdits({});
  }, [collectProposalChanges, data, save, user]);

  const activeTheme = page === "theme" ? tempTheme : theme;
  if (loading || !authReady) return <div className="flex items-center justify-center h-screen text-slate-500 font-medium">Loading Julia's Schedule...</div>;

  if (isRecoveryMode) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6">
        <div className="w-full max-w-sm bg-white rounded-2xl shadow-xl shadow-slate-200/50 p-8 border border-slate-100">
          <div className="text-center mb-6">
            <h1 className="text-2xl font-bold text-slate-900">Set New Password</h1>
            <p className="text-slate-500 mt-2 text-sm">You opened a recovery link. Set a new password to continue.</p>
          </div>
          <div className="space-y-3">
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="New password (min 8 chars)"
              className="w-full p-3 rounded-xl border border-slate-200 outline-none focus:border-blue-400"
            />
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Confirm new password"
              className="w-full p-3 rounded-xl border border-slate-200 outline-none focus:border-blue-400"
            />
            <button
              disabled={authBusy}
              onClick={updatePasswordFromRecovery}
              className="w-full p-3 rounded-xl bg-blue-500 hover:bg-blue-600 disabled:opacity-60 text-white transition-all font-semibold"
            >
              Update Password
            </button>
            {recoveryMessage && (
              <p className="text-xs text-slate-700 bg-slate-50 border border-slate-200 rounded-lg p-2">{recoveryMessage}</p>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (page === "theme") {
    return <ThemeEditor theme={tempTheme} onChange={setTempTheme} onSave={() => { save(data, tempTheme); setPage("main"); }} onCancel={() => { setTempTheme(theme); setPage("main"); }} />;
  }

  if (!user) {
    const loginColors = activeTheme;
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6">
        <div className="w-full max-w-sm bg-white rounded-2xl shadow-xl shadow-slate-200/50 p-8 border border-slate-100">
          <div className="text-center mb-8">
            <div className="w-16 h-16 bg-blue-500 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-blue-200"><Calendar className="text-white w-8 h-8" /></div>
            <h1 className="text-2xl font-bold text-slate-900">Julia's Schedule</h1>
            <p className="text-slate-500 mt-2">Co-parenting made simpler</p>
          </div>
          {supabase ? (
            <div className="space-y-3">
              <input
                type="email"
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                placeholder="Email"
                className="w-full p-3 rounded-xl border border-slate-200 outline-none focus:border-blue-400"
              />
              <input
                type="password"
                value={passwordInput}
                onChange={(e) => setPasswordInput(e.target.value)}
                placeholder="Password"
                className="w-full p-3 rounded-xl border border-slate-200 outline-none focus:border-blue-400"
              />
              <button
                disabled={authBusy}
                onClick={signInWithEmail}
                className="w-full p-3 rounded-xl bg-blue-500 hover:bg-blue-600 disabled:opacity-60 text-white transition-all font-semibold"
              >
                Sign In
              </button>
              <button
                disabled={authBusy}
                onClick={signUpWithEmail}
                className="w-full p-3 rounded-xl border border-slate-200 hover:border-blue-400 hover:bg-blue-50 transition-all font-semibold text-slate-700 disabled:opacity-60"
              >
                Create Account
              </button>
              {authError && (
                <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg p-2">{authError}</p>
              )}
              {showResetOption && (
                <button
                  disabled={authBusy}
                  onClick={sendPasswordReset}
                  className="w-full p-2.5 rounded-xl border border-amber-200 hover:bg-amber-50 text-amber-700 transition-all font-semibold text-sm disabled:opacity-60"
                >
                  Send Password Reset
                </button>
              )}
              {authEmail && !resolveUserFromEmail(authEmail) && (
                <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg p-2">
                  Signed in as {authEmail}, but it is not mapped to Collin or Tiia. Set `VITE_COLLIN_EMAIL` and
                  `VITE_TIIA_EMAIL` in your env.
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {["collin", "tiia"].map((u) => (
                <button key={u} onClick={() => setUser(u as any)} className="w-full flex items-center gap-4 p-4 rounded-xl border border-slate-200 hover:border-blue-400 hover:bg-blue-50 transition-all group">
                  <div className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm" style={{ backgroundColor: loginColors[u as "collin" | "tiia"].bg, color: loginColors[u as "collin" | "tiia"].text }}>{u[0].toUpperCase()}</div>
                  <span className="font-semibold text-slate-700 capitalize">{u}</span>
                  <ChevronRight className="ml-auto w-5 h-5 text-slate-300 group-hover:text-blue-500 transition-colors" />
                </button>
              ))}
            </div>
          )}
          <p className="mt-4 text-[11px] text-slate-400 text-center">
            v{APP_VERSION} • {buildLabel} • b{BUILD_ID} • {GIT_SHA}
          </p>
        </div>
      </div>
    );
  }

  const pendingIncoming = data?.proposals?.filter((p: any) => p.status === "pending" && p.from !== user) || [];
  const pendingOutgoing = data?.proposals?.filter((p: any) => p.status === "pending" && p.from === user) || [];

  if (page === "history") {
    return (
      <div className="max-w-2xl mx-auto p-4 sm:p-6 min-h-screen bg-slate-50">
        <div className="flex items-center gap-4 mb-8">
          <button onClick={() => setPage("main")} className="p-2 hover:bg-white rounded-lg border border-transparent hover:border-slate-200 transition-all"><ChevronLeft className="w-6 h-6 text-slate-600" /></button>
          <h2 className="text-2xl font-bold text-slate-900">Proposal History</h2>
        </div>
        <div className="space-y-4">
          {data.proposals.slice().sort((a: any, b: any) => new Date(b.created).getTime() - new Date(a.created).getTime()).map((p: any) => (
            <div key={p.id} className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
              <div className="flex justify-between items-start mb-3">
                <div className="flex items-center gap-3"><StatusBadge status={p.status} /><span className="font-semibold text-slate-800 capitalize">{p.from}</span></div>
                <span className="text-xs text-slate-400">{new Date(p.created).toLocaleDateString()}</span>
              </div>
              <div className="space-y-1">
                {p.changes.map((c: any) => (
                  <div key={c.date} className="text-sm text-slate-600 flex items-center gap-2">
                    <span className="font-medium min-w-[80px]">{fmtDay(new Date(c.date))}</span>
                    <Pill who={c.was.night} theme={activeTheme} small />
                    <ChevronRight className="w-3 h-3 text-slate-300" />
                    <Pill who={c.to.night} theme={activeTheme} small />
                  </div>
                ))}
              </div>
              {p.status === "forced" && (
                <p className="mt-2 text-xs text-red-700 font-semibold bg-red-50 border border-red-100 rounded-lg px-2 py-1">
                  Forced by {p.forcedBy || p.respondedBy || p.from} at {new Date(p.forcedAt || p.respondedAt || p.created).toLocaleString()}
                </p>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto p-4 sm:p-6 min-h-screen bg-slate-50">
      <header className="flex items-center justify-between mb-8 bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-blue-500 rounded-xl flex items-center justify-center shadow-lg shadow-blue-100"><Calendar className="text-white w-5 h-5" /></div>
          <div><h1 className="font-bold text-slate-900">Julia's Schedule</h1><p className="text-[11px] text-slate-400 font-medium uppercase tracking-wider">Co-Parenting Dashboard</p></div>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={() => { setTempTheme(theme); setPage("theme"); }} className="p-2 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-all" title="Theme Editor"><div className="w-5 h-5 rounded-full border-2 border-slate-400 flex items-center justify-center"><div className="w-2 h-2 rounded-full bg-slate-400" /></div></button>
          <button onClick={() => setPage("history")} className="p-2 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-all" title="History"><HistoryIcon className="w-5 h-5" /></button>
          <button onClick={handleLogout} className="flex items-center gap-2 pl-2 pr-3 py-1.5 bg-slate-50 hover:bg-slate-100 rounded-full border border-slate-200 transition-all group"><div className="w-7 h-7 rounded-full flex items-center justify-center font-bold text-[10px]" style={{ backgroundColor: activeTheme[user].bg, color: activeTheme[user].text }}>{user[0].toUpperCase()}</div><LogOut className="w-4 h-4 text-slate-400 group-hover:text-slate-600" /></button>
        </div>
      </header>
      <div className="text-right text-[11px] text-slate-400 -mt-5 mb-4">v{APP_VERSION} • {buildLabel} • b{BUILD_ID} • {GIT_SHA}</div>

      <div className="flex gap-16 mb-4 px-2 text-[11px] text-slate-400 font-bold uppercase tracking-wider items-center">
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: activeTheme.collin.primary }} /> Collin</span>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: activeTheme.tiia.primary }} /> Tiia</span>
        {pendingIncoming.length > 0 && <span className="ml-auto text-amber-500">{pendingIncoming.length} to review</span>}
      </div>

      <section className="mb-8">
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="grid grid-cols-7 border-b border-slate-400">{DAYS_HDR.map((d) => <div key={d} className="py-3 text-center text-[11px] font-bold text-slate-500 uppercase tracking-widest border-r border-slate-400 last:border-r-0">{d}</div>)}</div>
          <div className="grid grid-cols-7">
            {allDays.map((d) => {
              const k = fmt(d);
              const entry = data.schedule[k] || { night: "collin", pickup: "5:30 PM", daycare: false, note: "" };
              const isToday = k === todayKey;
              const evts = (EVENTS[k] || []).filter((e) => !e.w || e.w === user || e.w === "both");
              const nightColor = activeTheme[entry.night as "collin" | "tiia"];
              return (
                <div key={k} className={`relative aspect-square border-r border-b border-slate-400 last:border-r-0 transition-colors ${isToday ? "ring-2 ring-inset ring-blue-500 z-10" : ""}`} style={{ backgroundColor: nightColor.bg }}>
                  <div className="absolute inset-0 p-2 flex flex-col">
                    <div className="flex justify-between items-start mb-1"><span className={`text-sm font-bold ${isToday ? "text-blue-600" : "text-slate-700"}`}>{d.getDate()}</span></div>
                    <div className="mt-auto px-1.5 py-0.5 text-[10px] font-black uppercase tracking-widest truncate bg-white/30 rounded shadow-sm" style={{ color: nightColor.text }}>{entry.night}</div>
                    {entry.daycare && <div className="mt-0.5 text-[8px] font-bold text-slate-500/70 uppercase tracking-tighter">Daycare</div>}
                    <div className="mt-1 space-y-0.5 overflow-hidden">{evts.slice(0, 2).map((ev, idx) => <div key={idx} className="text-[8px] text-slate-600/80 truncate leading-tight font-medium">- {ev.t}</div>)}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Schedule Detail</h3>
          <div className="flex gap-2">
            {Object.keys(edits).length > 0 && <button onClick={() => setEdits({})} className="text-[11px] font-bold text-blue-600 hover:text-blue-700 mr-2">Discard Edits</button>}
            <div className="flex items-center bg-white border border-slate-200 rounded-lg overflow-hidden shadow-sm">
              <button onClick={() => setRangeStart((prev) => addD(prev, -7))} className="p-2 hover:bg-slate-50 text-slate-600 transition-all border-r border-slate-100" title="Add Previous Week"><Plus className="w-3 h-3" /></button>
              {canRemovePrev && <button onClick={() => setRangeStart((prev) => addD(prev, 7))} className="p-2 hover:bg-rose-50 text-rose-500 transition-all" title="Remove Previous Week"><Minus className="w-3 h-3" /></button>}
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden mb-4">
          {allDays.map((d) => {
            const k = fmt(d);
            const original = data.schedule[k] || { night: "collin", pickup: "5:30 PM", daycare: false, note: "" };
            const current = edits[k] || original;
            const isChanged = JSON.stringify(original) !== JSON.stringify(current);
            const isToday = k === todayKey;
            const nightColor = activeTheme[current.night as "collin" | "tiia"];
            const isNoteOpen = noteOpen === k;
            return (
              <div key={k} className={`border-b border-slate-100 last:border-0 transition-colors ${isChanged ? "bg-amber-50/40" : ""}`} style={!isChanged ? { backgroundColor: nightColor.bg } : {}}>
                <div className="p-4 grid grid-cols-[1fr_auto] sm:grid-cols-[1.5fr_auto_auto_auto_auto] items-center gap-x-4 gap-y-3">
                  <div className="min-w-0"><div className="flex items-center gap-2"><span className={`font-bold text-sm ${isToday ? "text-blue-600" : "text-slate-800"}`}>{fmtDay(d)}</span></div></div>
                  <div className="flex justify-end sm:justify-center w-[80px]"><NightToggle value={current.night} theme={activeTheme} onChange={(v) => setEdits((prev) => ({ ...prev, [k]: { ...current, night: v } }))} /></div>
                  <div className="flex justify-start sm:justify-center w-[90px]"><DaycareToggle on={current.daycare} theme={activeTheme} onToggle={() => setEdits((prev) => ({ ...prev, [k]: { ...current, daycare: !current.daycare } }))} /></div>
                  <div className="flex justify-start sm:justify-center w-[100px]">
                    {!current.daycare ? (
                      <select value={current.pickup} onChange={(e) => setEdits((prev) => ({ ...prev, [k]: { ...current, pickup: e.target.value } }))} className="text-[11px] font-medium bg-white border border-slate-200 rounded-lg px-2 py-1 outline-none focus:border-blue-400 w-full">{TIMES.map((t) => <option key={t} value={t}>{t}</option>)}</select>
                    ) : <div className="text-[10px] text-slate-400 italic px-2">No pickup</div>}
                  </div>
                  <div className="flex items-center justify-end gap-2 w-[70px]">
                    <button onClick={() => setNoteOpen(isNoteOpen ? null : k)} className={`p-2 rounded-lg transition-all ${current.note || isNoteOpen ? "bg-blue-50 text-blue-600" : "text-slate-300 hover:text-slate-500 hover:bg-slate-50"}`}><StickyNote className="w-4 h-4" /></button>
                    <div className="w-8 h-8 flex items-center justify-center">{isChanged && <button onClick={() => { const next = { ...edits }; delete next[k]; setEdits(next); }} className="p-2 text-amber-500 hover:bg-amber-50 rounded-lg transition-all" title="Undo changes"><Undo2 className="w-4 h-4" /></button>}</div>
                  </div>
                </div>
                <AnimatePresence>{isNoteOpen && <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden"><div className="px-4 pb-4"><textarea value={current.note || ""} onChange={(e) => setEdits((prev) => ({ ...prev, [k]: { ...current, note: e.target.value } }))} placeholder="Add a note for this day..." className="w-full text-xs p-3 bg-white border border-slate-200 rounded-xl outline-none focus:border-blue-400 min-h-[60px] resize-none" /></div></motion.div>}</AnimatePresence>
              </div>
            );
          })}
        </div>

        <div className="flex justify-center gap-3"><div className="flex items-center bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm"><button onClick={() => setRangeWeeks((prev) => prev + 1)} className="flex items-center gap-2 px-6 py-2 hover:bg-slate-50 text-[12px] font-bold text-slate-600 transition-all border-r border-slate-100"><Plus className="w-4 h-4" /> Next Week</button>{canRemoveNext && <button onClick={() => setRangeWeeks((prev) => prev - 1)} className="px-4 py-2 hover:bg-rose-50 text-rose-500 transition-all" title="Remove Next Week"><Minus className="w-4 h-4" /></button>}</div></div>
      </section>

      <AnimatePresence>
        {Object.keys(edits).length > 0 && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="mb-8 overflow-hidden">
            <div className="bg-slate-900 text-white p-6 rounded-2xl shadow-xl flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3"><div className="w-10 h-10 bg-blue-500 rounded-xl flex items-center justify-center"><Plus className="w-6 h-6" /></div><div><p className="font-bold text-base">{Object.keys(edits).length} Change{Object.keys(edits).length > 1 ? "s" : ""}</p></div></div>
                <div className="flex items-center gap-2">
                  <button onClick={handleSendProposal} className="px-6 py-2.5 bg-blue-500 hover:bg-blue-600 text-white rounded-xl font-bold text-sm transition-all shadow-lg shadow-blue-500/20">Send Proposal</button>
                  <button onClick={handleForceProposal} className="px-6 py-2.5 bg-red-500 hover:bg-red-600 text-white rounded-xl font-bold text-sm transition-all shadow-lg shadow-red-500/20">Force Proposal</button>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {(pendingIncoming.length > 0 || pendingOutgoing.length > 0) && (
        <section className="mb-12 space-y-3">
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Active Proposals</h3>
          {pendingIncoming.map((p: any) => <ProposalCard key={p.id} p={p} type="in" theme={activeTheme} onRespond={handleRespond} />)}
          {pendingOutgoing.map((p: any) => <ProposalCard key={p.id} p={p} type="out" theme={activeTheme} />)}
        </section>
      )}
    </div>
  );
}

function ProposalCard({ p, type, theme, onRespond }: { p: any; type: "in" | "out"; theme: any; onRespond?: (id: string, status: string, resp: string) => void }) {
  const [open, setOpen] = useState(type === "in");
  const [reply, setReply] = useState("");
  const otherUser = p.from === "collin" ? "Collin" : "Tiia";
  return (
    <div className={`rounded-2xl border transition-all ${type === "in" ? "bg-amber-50 border-amber-200 shadow-sm" : "bg-white border-slate-200"}`}>
      <button onClick={() => setOpen(!open)} className="w-full p-4 flex items-center justify-between text-left">
        <div className="flex items-center gap-3">
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${type === "in" ? "bg-amber-200 text-amber-700" : "bg-slate-100 text-slate-500"}`}>{type === "in" ? <AlertCircle className="w-5 h-5" /> : <Clock className="w-5 h-5" />}</div>
          <div><p className="font-bold text-sm text-slate-900">{type === "in" ? `Proposal from ${otherUser}` : `Sent to ${p.from === "collin" ? "Tiia" : "Collin"}`}</p><p className="text-[10px] text-slate-500 font-medium uppercase tracking-wider">{p.changes.length} Change{p.changes.length > 1 ? "s" : ""}</p></div>
        </div>
        <ChevronRight className={`w-5 h-5 text-slate-400 transition-transform ${open ? "rotate-90" : ""}`} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="px-4 pb-4 space-y-3">
              <div className="space-y-2">{p.changes.map((c: any) => <div key={c.date} className="flex items-center gap-3 text-xs bg-white/40 p-2 rounded-lg"><span className="font-bold text-slate-500 min-w-[80px]">{fmtDay(new Date(c.date))}</span><div className="flex items-center gap-2"><Pill who={c.was?.night || "collin"} theme={theme} small /><ChevronRight className="w-3 h-3 text-slate-300" /><Pill who={c.to?.night || "collin"} theme={theme} small /></div></div>)}</div>
              {type === "in" && onRespond && (
                <div className="pt-3 border-t border-amber-200/50 space-y-3">
                  <textarea value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Add a reply..." className="w-full text-xs p-3 bg-white border border-amber-200 rounded-xl outline-none focus:border-amber-400 min-h-[60px] resize-none" />
                  <div className="flex gap-2">
                    <button onClick={() => onRespond(p.id, "accepted", reply)} className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl font-bold text-xs transition-all"><CheckCircle2 className="w-4 h-4" /> Accept</button>
                    <button onClick={() => onRespond(p.id, "declined", reply)} className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-rose-500 hover:bg-rose-600 text-white rounded-xl font-bold text-xs transition-all"><XCircle className="w-4 h-4" /> Decline</button>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
