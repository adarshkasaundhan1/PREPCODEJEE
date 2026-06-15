// supabase-client.js

const SUPABASE_URL = "https://foxxccgiktgrwfdlxkrx.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZveHhjY2dpa3RncndmZGx4a3J4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE1MjgwMTUsImV4cCI6MjA5NzEwNDAxNX0.2ba1TVUvHoCzQfSF0H97V4X-5KoZ6BbgIzzW1zPihHQ"; // keep your real key here

// Your production app URL (GitHub Pages project site)
const PROD_REDIRECT_URL = "https://adarshkasaundhan1.github.io/PREPCODEJEE/";

// Optional local fallback for desktop testing
const LOCAL_REDIRECT_URL = "http://localhost:5500/";

if (!window.supabase) {
  throw new Error("Supabase SDK not loaded. Add @supabase/supabase-js CDN before this file.");
}
if (!SUPABASE_URL) {
  console.warn("SUPABASE_URL is not configured in supabase-client.js");
}
if (!SUPABASE_ANON_KEY || SUPABASE_ANON_KEY.includes("YOUR_SUPABASE_ANON_KEY_HERE")) {
  console.warn("SUPABASE_ANON_KEY is not configured in supabase-client.js");
}

window.sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true
  }
});

function getEmailRedirectTo() {
  const host = window.location.hostname;
  if (host === "localhost" || host === "127.0.0.1") return LOCAL_REDIRECT_URL;
  return PROD_REDIRECT_URL;
}

function normalizeSubject(subject) {
  const s = String(subject || "").trim().toLowerCase();
  if (s === "physics" || s.includes("phys")) return "Physics";
  if (s === "chemistry" || s.includes("chem")) return "Chemistry";
  if (s === "math" || s === "maths" || s === "mathematics" || s.includes("math")) return "Mathematics";
  return subject || "Mathematics";
}

function toProblemId(value) {
  const n = Number(value);
  if (Number.isFinite(n) && n > 0) return n;
  const m = String(value || "").match(/\d+/);
  return m ? Number(m[0]) : 1;
}

window.PC = {
  async getUser() {
    const { data, error } = await sb.auth.getUser();
    if (error) {
      console.error("getUser error:", error);
      return null;
    }
    return data?.user || null;
  },

async signInWithEmail(email) {
    const cleanEmail = String(email || "").trim().toLowerCase();
    if (!cleanEmail) return { ok: false, error: { message: "Email is required." } };

const redirectTo = getEmailRedirectTo();

const { data, error } = await sb.auth.signInWithOtp({
      email: cleanEmail,
      options: { emailRedirectTo: redirectTo }
    });

if (error) {
      console.error("signInWithEmail error:", error);
      return { ok: false, error };
    }
    return { ok: true, data };
  },

async signOut() {
    const { error } = await sb.auth.signOut();
    if (error) {
      console.error("signOut error:", error);
      return { ok: false, error };
    }
    return { ok: true };
  },

async ensureProfile(user) {
    if (!user?.id) return { ok: false, error: { message: "Invalid user for profile upsert." } };

const payload = {
      id: user.id,
      email: user.email || null,
      name: user.user_metadata?.name || user.email?.split("@")[0] || "PrepCoder",
      updated_at: new Date().toISOString()
    };

const { data, error } = await sb.from("profiles").upsert(payload, { onConflict: "id" });
    if (error) {
      console.error("ensureProfile error:", error);
      return { ok: false, error };
    }
    return { ok: true, data };
  },

async markSolved(userId, subject, problemId, selectedOption, isCorrect) {
    const payload = {
      user_id: userId,
      subject: normalizeSubject(subject),
      problem_id: toProblemId(problemId),
      selected_option: String(selectedOption || "").toUpperCase(),
      is_correct: !!isCorrect,
      solved_at: isCorrect ? new Date().toISOString() : null,
      updated_at: new Date().toISOString()
    };

const { data, error } = await sb
      .from("problem_attempts")
      .upsert(payload, { onConflict: "user_id,subject,problem_id" });

if (error) {
      console.error("markSolved error:", error);
      return { ok: false, error };
    }
    return { ok: true, data };
  },

async toggleBookmark(userId, subject, problemId) {
    const s = normalizeSubject(subject);
    const pid = toProblemId(problemId);

const { data: existing, error: findErr } = await sb
      .from("bookmarks")
      .select("id")
      .eq("user_id", userId)
      .eq("subject", s)
      .eq("problem_id", pid)
      .maybeSingle();

if (findErr) {
      console.error("toggleBookmark(find) error:", findErr);
      return { ok: false, error: findErr, bookmarked: null };
    }

if (existing?.id) {
      const { error: delErr } = await sb.from("bookmarks").delete().eq("id", existing.id);
      if (delErr) {
        console.error("toggleBookmark(delete) error:", delErr);
        return { ok: false, error: delErr, bookmarked: null };
      }
      return { ok: true, bookmarked: false };
    }

const { error: insErr } = await sb.from("bookmarks").insert({
      user_id: userId,
      subject: s,
      problem_id: pid
    });

if (insErr) {
      console.error("toggleBookmark(insert) error:", insErr);
      return { ok: false, error: insErr, bookmarked: null };
    }

return { ok: true, bookmarked: true };
  },

async pushRecent(userId, p) {
    const payload = {
      user_id: userId,
      subject: normalizeSubject(p?.subject),
      topic: p?.topic || "",
      difficulty: p?.difficulty || "Easy",
      marks: Number(p?.marks) || 4,
      source: p?.source || "JEE Main",
      title: p?.title || "",
      text: p?.text || "",
      option_a: p?.a || "",
      option_b: p?.b || "",
      option_c: p?.c || "",
      option_d: p?.d || "",
      correct: String(p?.correct || "").toUpperCase(),
      explain: p?.explain || "",
      back: p?.back || "",
      created_at: new Date().toISOString()
    };

const { data, error } = await sb.from("recent_activity").insert(payload);
    if (error) {
      console.error("pushRecent error:", error);
      return { ok: false, error };
    }
    return { ok: true, data };
  }
};
