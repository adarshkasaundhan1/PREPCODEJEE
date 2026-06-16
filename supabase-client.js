// supabase-client.js

const SUPABASE_URL = "https://foxxccgiktgrwfdlxkrx.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZveHhjY2dpa3RncndmZGx4a3J4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE1MjgwMTUsImV4cCI6MjA5NzEwNDAxNX0.2ba1TVUvHoCzQfSF0H97V4X-5KoZ6BbgIzzW1zPihHQ"; // keep your real key
const PROD_REDIRECT_URL = "https://adarshkasaundhan1.github.io/PREPCODEJEE/index.html";
const LOCAL_REDIRECT_URL = "http://localhost:5500/index.html";

if (!window.supabase) {
  throw new Error("Supabase SDK not loaded. Add @supabase/supabase-js CDN before this file.");
}
if (!SUPABASE_URL) console.warn("SUPABASE_URL is missing.");
if (!SUPABASE_ANON_KEY) console.warn("SUPABASE_ANON_KEY is missing.");

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true
  }
});

// expose globally
window.sb = sb;

function getEmailRedirectTo() {
  const host = window.location.hostname;
  if (host === "localhost" || host === "127.0.0.1") return LOCAL_REDIRECT_URL;
  return PROD_REDIRECT_URL;
}

function normalizeSubject(subject) {
  const s = String(subject || "").trim().toLowerCase();
  if (s.includes("phys")) return "Physics";
  if (s.includes("chem")) return "Chemistry";
  return "Mathematics";
}

function isMissingRelationError(error) {
  const msg = String(error?.message || "").toLowerCase();
  return msg.includes("relation") && msg.includes("does not exist");
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
}

window.PC = {
  // expose client for pages
  supabase: sb,

// -------------------------
  // Auth
  // -------------------------
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

const { data, error } = await sb.auth.signInWithOtp({
      email: cleanEmail,
      options: { emailRedirectTo: getEmailRedirectTo() }
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

// -------------------------
  // Profile
  // profiles: id, email, role, created_at
  // -------------------------
  async ensureProfile(user) {
    if (!user?.id) return { ok: false, error: { message: "Invalid user." } };

const payload = {
      id: user.id,
      email: user.email || null
      // role default can come from DB
    };

const { data, error } = await sb
      .from("profiles")
      .upsert(payload, { onConflict: "id" })
      .select()
      .single();

if (error) {
      console.error("ensureProfile error:", error);
      return { ok: false, error };
    }
    return { ok: true, data };
  },

async getProfile(userId) {
    const { data, error } = await sb
      .from("profiles")
      .select("id,email,role,created_at")
      .eq("id", userId)
      .maybeSingle();

if (error) {
      console.error("getProfile error:", error);
      return { ok: false, error };
    }
    return { ok: true, data };
  },

// NEW: admin role check
  async isAdmin(userId) {
    if (!userId) return { ok: true, isAdmin: false };

const { data, error } = await sb
      .from("profiles")
      .select("role")
      .eq("id", userId)
      .maybeSingle();

if (error) {
      console.error("isAdmin error:", error);
      return { ok: false, error, isAdmin: false };
    }

return { ok: true, isAdmin: String(data?.role || "").toLowerCase() === "admin" };
  },

// NEW: convenience helper for current session
  async canCurrentUserAccessAdmin() {
    const user = await this.getUser();
    if (!user) return { ok: true, canAccess: false, user: null };

const roleRes = await this.isAdmin(user.id);
    if (!roleRes.ok) return { ok: false, canAccess: false, user, error: roleRes.error };

return { ok: true, canAccess: roleRes.isAdmin, user };
  },

// -------------------------
  // Questions
  // -------------------------
  async getActiveQuestions(limit = 100) {
    const safeLimit = Math.max(1, Math.min(500, Number(limit) || 100));

const { data, error } = await sb
      .from("questions")
      .select("*")
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(safeLimit);

if (error) {
      console.error("getActiveQuestions error:", error);
      return { ok: false, error, data: [] };
    }
    return { ok: true, data: data || [] };
  },

async getQuestionsBySubject(subject, limit = 100) {
    const safeLimit = Math.max(1, Math.min(500, Number(limit) || 100));
    const normalized = normalizeSubject(subject);

const { data, error } = await sb
      .from("questions")
      .select("*")
      .eq("is_active", true)
      .eq("subject", normalized)
      .order("created_at", { ascending: false })
      .limit(safeLimit);

if (error) {
      console.error("getQuestionsBySubject error:", error);
      return { ok: false, error, data: [] };
    }
    return { ok: true, data: data || [] };
  },

// -------------------------
  // Solved tracking
  // user_solved: user_id, question_id (uuid), is_correct
  // -------------------------
  async getUserSolvedIds(userId) {
    const { data, error } = await sb
      .from("user_solved")
      .select("question_id")
      .eq("user_id", userId);

if (error) {
      console.error("getUserSolvedIds error:", error);
      return { ok: false, error, data: [] };
    }

const ids = (data || []).map(r => String(r.question_id));
    return { ok: true, data: ids };
  },

async saveUserSolved(userId, questionId, isCorrect = true) {
    if (!userId) return { ok: false, error: { message: "userId is required." } };
    if (!isUuid(questionId)) {
      return {
        ok: false,
        error: { message: `questionId must be UUID. Received: ${questionId}` }
      };
    }

const payload = {
      user_id: userId,
      question_id: questionId,
      is_correct: !!isCorrect
    };

const { data, error } = await sb
      .from("user_solved")
      .upsert(payload, { onConflict: "user_id,question_id" })
      .select()
      .single();

if (error) {
      console.error("saveUserSolved error:", error);
      return { ok: false, error };
    }
    return { ok: true, data };
  },

// Backward-compatible alias
  async markSolved(userId, subject, problemId, selectedOption, isCorrect) {
    return this.saveUserSolved(userId, problemId, !!isCorrect);
  },

// -------------------------
  // Recent activity compatibility (optional)
  // -------------------------
  async getRecentActivity(userId, limit = 20) {
    const safeLimit = Math.max(1, Math.min(50, Number(limit) || 20));

const oldRes = await sb
      .from("recent_activity")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(safeLimit);

if (!oldRes.error) {
      return { ok: true, data: oldRes.data || [] };
    }

if (!isMissingRelationError(oldRes.error)) {
      console.error("getRecentActivity error:", oldRes.error);
      return { ok: false, error: oldRes.error, data: [] };
    }

// fallback to questions
    const { data, error } = await sb
      .from("questions")
      .select("*")
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(safeLimit);

if (error) {
      console.error("getRecentActivity fallback error:", error);
      return { ok: false, error, data: [] };
    }

const mapped = (data || []).map(q => ({
      problem_id: q.id,
      subject: q.subject,
      topic: q.topic,
      difficulty: q.difficulty,
      marks: q.marks,
      source: q.source,
      title: q.title,
      text: q.text,
      option_a: q.option_a,
      option_b: q.option_b,
      option_c: q.option_c,
      option_d: q.option_d,
      correct: q.correct,
      explain: q.explain,
      created_at: q.created_at
    }));

return { ok: true, data: mapped };
  },

async pushRecent(userId, p) {
    // optional only; safe if table missing
    const payload = {
      user_id: userId,
      subject: normalizeSubject(p?.subject),
      topic: p?.topic || "",
      difficulty: p?.difficulty || "Easy",
      marks: Number(p?.marks) || 4,
      source: p?.source || "",
      title: p?.title || "",
      text: p?.text || "",
      option_a: p?.a || "",
      option_b: p?.b || "",
      option_c: p?.c || "",
      option_d: p?.d || "",
      correct: String(p?.correct || "A").toUpperCase(),
      explain: p?.explain || "",
      created_at: new Date().toISOString()
    };

const { data, error } = await sb.from("recent_activity").insert(payload).select();

if (error) {
      if (!isMissingRelationError(error)) console.error("pushRecent error:", error);
      return { ok: false, error };
    }
    return { ok: true, data };
  },

// -------------------------
  // Streak methods
  // -------------------------
  async getStreak(userId) {
    const { data, error } = await sb
      .from("user_streaks")
      .select("current_streak,best_streak,last_solved_date")
      .eq("user_id", userId)
      .maybeSingle();

if (error) {
      if (isMissingRelationError(error)) {
        return {
          ok: true,
          data: { current_streak: 0, best_streak: 0, last_solved_date: null }
        };
      }
      console.error("getStreak error:", error);
      return { ok: false, error };
    }

if (!data) {
      const seed = {
        user_id: userId,
        current_streak: 0,
        best_streak: 0,
        last_solved_date: null
      };

const { data: ins, error: insErr } = await sb
        .from("user_streaks")
        .insert(seed)
        .select()
        .single();

if (insErr) {
        if (isMissingRelationError(insErr)) {
          return {
            ok: true,
            data: { current_streak: 0, best_streak: 0, last_solved_date: null }
          };
        }
        console.error("getStreak seed error:", insErr);
        return { ok: false, error: insErr };
      }

return { ok: true, data: ins };
    }

return { ok: true, data };
  },

async updateStreakOnSolve(userId) {
    const base = await this.getStreak(userId);
    if (!base.ok) return base;

const row = base.data || {};
    const today = new Date().toISOString().slice(0, 10);
    const last = row.last_solved_date;

let current = Number(row.current_streak || 0);
    let best = Number(row.best_streak || 0);

if (!last) {
      current = 1;
    } else {
      const d1 = new Date(last + "T00:00:00Z");
      const d2 = new Date(today + "T00:00:00Z");
      const diff = Math.floor((d2 - d1) / (1000 * 60 * 60 * 24));

if (diff === 0) {
        // already counted today
      } else if (diff === 1) {
        current += 1;
      } else {
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
          last_solved_date: today
        },
        { onConflict: "user_id" }
      )
      .select()
      .single();

if (error) {
      if (isMissingRelationError(error)) {
        return {
          ok: true,
          data: { current_streak: current, best_streak: best, last_solved_date: today }
        };
      }
      console.error("updateStreakOnSolve error:", error);
      return { ok: false, error };
    }

return { ok: true, data };
  },

// Optional old API compatibility
  async toggleBookmark() {
    return {
      ok: false,
      error: { message: "Bookmarks table not configured in current schema." },
      bookmarked: null
    };
  }
};
