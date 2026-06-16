// supabase-client.js

const SUPABASE_URL = "https://foxxccgiktgrwfdlxkrx.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZveHhjY2dpa3RncndmZGx4a3J4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE1MjgwMTUsImV4cCI6MjA5NzEwNDAxNX0.2ba1TVUvHoCzQfSF0H97V4X-5KoZ6BbgIzzW1zPihHQ";

// Your production app URL (GitHub Pages project site)
const PROD_REDIRECT_URL = "https://adarshkasaundhan1.github.io/PREPCODEJEE/index.html";

// Optional local fallback for desktop testing
const LOCAL_REDIRECT_URL = "http://localhost:5500/";

if (!window.supabase) {
  throw new Error("Supabase SDK not loaded. Add @supabase/supabase-js CDN before this file.");
}
if (!SUPABASE_URL) {
  console.warn("SUPABASE_URL is not configured in supabase-client.js");
}
if (!SUPABASE_ANON_KEY) {
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

function daysDiffUTC(fromDateStr, toDateStr) {
  const from = new Date(fromDateStr + "T00:00:00Z");
  const to = new Date(toDateStr + "T00:00:00Z");
  return Math.floor((to - from) / (1000 * 60 * 60 * 24));
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
  },

// NEW: DB recent fetch (Version 2 - DB first, local fallback in index.html)
  async getRecentActivity(userId, limit = 1) {
    const safeLimit = Math.max(1, Math.min(50, Number(limit) || 1));

const { data, error } = await sb
      .from("recent_activity")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(safeLimit);

if (error) {
      console.error("getRecentActivity error:", error);
      return { ok: false, error };
    }
    return { ok: true, data: data || [] };
  },

// -------------------------
  // STREAK METHODS (DB-based)
  // Rule:
  // - +1 only once per day when at least one correct solve happens
  // - same-day correct solves do not increase again
  // - if a day is missed, streak becomes 0
  // -------------------------

async getStreak(userId) {
    const { data, error } = await sb
      .from("user_streaks")
      .select("current_streak,best_streak,last_solved_date")
      .eq("user_id", userId)
      .maybeSingle();

if (error) {
      console.error("getStreak error:", error);
      return { ok: false, error };
    }

// Auto-create row if not exists
    if (!data) {
      const seed = {
        user_id: userId,
        current_streak: 0,
        best_streak: 0,
        last_solved_date: null,
        updated_at: new Date().toISOString()
      };

const { data: ins, error: insErr } = await sb
        .from("user_streaks")
        .insert(seed)
        .select()
        .single();

if (insErr) {
        console.error("getStreak seed insert error:", insErr);
        return { ok: false, error: insErr };
      }

return { ok: true, data: ins };
    }

// Lazy reset: if missed at least one full day after last solved day => streak = 0
    if (data.last_solved_date) {
      const todayStr = new Date().toISOString().slice(0, 10);
      const diff = daysDiffUTC(data.last_solved_date, todayStr);

// diff 0 => same day, diff 1 => yesterday (still valid), diff >1 => missed day(s)
      if (diff > 1 && data.current_streak !== 0) {
        const { data: upd, error: updErr } = await sb
          .from("user_streaks")
          .update({
            current_streak: 0,
            updated_at: new Date().toISOString()
          })
          .eq("user_id", userId)
          .select()
          .single();

if (updErr) {
          console.error("getStreak lazy reset error:", updErr);
          return { ok: false, error: updErr };
        }

return { ok: true, data: upd };
      }
    }

return { ok: true, data };
  },

async updateStreakOnSolve(userId) {
    // Call this ONLY when answer is correct
    const baseRes = await this.getStreak(userId);
    if (!baseRes.ok) return baseRes;

const row = baseRes.data;
    const todayStr = new Date().toISOString().slice(0, 10);

let current = row.current_streak || 0;
    let best = row.best_streak || 0;
    const last = row.last_solved_date;

if (!last) {
      current = 1;
    } else {
      const diff = daysDiffUTC(last, todayStr);

if (diff === 0) {
        // already counted today -> no increment
      } else if (diff === 1) {
        // consecutive day
        current += 1;
      } else {
        // missed day(s), start new streak today
        current = 1;
      }
    }

if (current > best) best = current;

const { data, error } = await sb
      .from("user_streaks")
      .upsert(
        {
          user_id: userId,
          current_streak: current,
          best_streak: best,
          last_solved_date: todayStr,
          updated_at: new Date().toISOString()
        },
        { onConflict: "user_id" }
      )
      .select()
      .single();

if (error) {
      console.error("updateStreakOnSolve error:", error);
      return { ok: false, error };
    }

return { ok: true, data };
  }
};
