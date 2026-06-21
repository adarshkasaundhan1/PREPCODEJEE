import express from "express";
import cors from "cors";
import crypto from "crypto";
import Razorpay from "razorpay";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

const app = express();

/**
 * IMPORTANT:
 * Webhook route must use raw body for signature verification.
 */
app.use("/api/razorpay/webhook", express.raw({ type: "*/*" }));

/* ------------------ CORS ------------------ */
const allowedOrigins = String(process.env.APP_ORIGIN || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      // allow non-browser clients (curl/postman/server)
      if (!origin) return callback(null, true);

// if APP_ORIGIN not set, allow all
      if (allowedOrigins.length === 0) return callback(null, true);

// allow configured origins
      if (allowedOrigins.includes(origin)) return callback(null, true);

return callback(new Error("CORS blocked"));
    },
    credentials: true,
  })
);

app.use(express.json());

/* ------------------ ENV ------------------ */
const {
  RAZORPAY_KEY_ID,
  RAZORPAY_KEY_SECRET,
  RAZORPAY_WEBHOOK_SECRET,
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  APP_BASE_URL,
} = process.env;

function hasRequiredEnv() {
  return (
    !!RAZORPAY_KEY_ID &&
    !!RAZORPAY_KEY_SECRET &&
    !!RAZORPAY_WEBHOOK_SECRET &&
    !!SUPABASE_URL &&
    !!SUPABASE_SERVICE_ROLE_KEY
  );
}

/* ------------------ Clients ------------------ */
const razorpay =
  RAZORPAY_KEY_ID && RAZORPAY_KEY_SECRET
    ? new Razorpay({
        key_id: RAZORPAY_KEY_ID,
        key_secret: RAZORPAY_KEY_SECRET,
      })
    : null;

const supabaseAdmin =
  SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    : null;

/* ------------------ Plans ------------------ */
const PLAN_CONFIG = {
  starter_monthly: { amountInr: 1, durationDays: 30, name: "Starter Monthly" },
  starter_yearly: { amountInr: 1199, durationDays: 365, name: "Starter Yearly" },
  pro_monthly: { amountInr: 299, durationDays: 30, name: "Pro Monthly" },
  pro_yearly: { amountInr: 1999, durationDays: 365, name: "Pro Yearly" },
  elite_monthly: { amountInr: 499, durationDays: 30, name: "Elite Monthly" },
  elite_yearly: { amountInr: 2999, durationDays: 365, name: "Elite Yearly" },
};

/* ------------------ Helpers ------------------ */
function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function ensureEnvOrRespond(res) {
  if (!hasRequiredEnv() || !razorpay || !supabaseAdmin) {
    console.error("❌ Missing required env vars.");
    res.status(500).json({ message: "Server configuration error" });
    return false;
  }
  return true;
}

async function getUserFromBearer(req) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return null;

const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user;
}

/* ------------------ Create Checkout ------------------ */
/**
 * POST /api/create-checkout
 * body: { planCode: "pro_monthly" }
 * auth: Authorization: Bearer <supabase access_token>
 */
app.post("/api/create-checkout", async (req, res) => {
  try {
    if (!ensureEnvOrRespond(res)) return;

const user = await getUserFromBearer(req);
    if (!user) return res.status(401).json({ message: "Unauthorized" });

const { planCode } = req.body || {};
    const plan = PLAN_CONFIG[planCode];
    if (!plan) return res.status(400).json({ message: "Invalid planCode" });

const amountPaise = plan.amountInr * 100;

const paymentLink = await razorpay.paymentLink.create({
      amount: amountPaise,
      currency: "INR",
      accept_partial: false,
      description: `PrepCode Premium - ${plan.name}`,
      customer: {
        name: (user.email || "PrepCode User").split("@")[0],
        email: user.email,
      },
      notify: {
        sms: false,
        email: true,
      },
      reminder_enable: true,
      callback_url: `${APP_BASE_URL || "http://localhost:5500"}/pricing-success.html`,
      callback_method: "get",
      notes: {
        user_id: user.id,
        plan_code: planCode,
        app: "prepcode",
      },
    });

return res.json({
      checkoutUrl: paymentLink.short_url,
      paymentLinkId: paymentLink.id,
    });
  } catch (e) {
    console.error("create-checkout error:", e);
    return res.status(500).json({ message: "Failed to create checkout" });
  }
});

/* ------------------ My Subscription Status ------------------ */
/**
 * GET /api/me/subscription
 * auth: Authorization: Bearer <supabase access_token>
 */
app.get("/api/me/subscription", async (req, res) => {
  try {
    if (!ensureEnvOrRespond(res)) return;

const user = await getUserFromBearer(req);
    if (!user) return res.status(401).json({ message: "Unauthorized" });

const { data, error } = await supabaseAdmin
      .from("profiles")
      .select("is_premium, premium_plan, premium_until")
      .eq("id", user.id)
      .maybeSingle();

if (error) {
      console.error("me/subscription read error:", error);
      return res.status(500).json({ message: "Failed to fetch subscription" });
    }

const now = new Date();
    const isPremium =
      !!data?.is_premium &&
      (!data?.premium_until || new Date(data.premium_until) > now);

return res.json({
      isPremium,
      plan: data?.premium_plan || null,
      premiumUntil: data?.premium_until || null,
      status: isPremium ? "active" : "inactive",
    });
  } catch (e) {
    console.error("me/subscription error:", e);
    return res.status(500).json({ message: "Failed to fetch subscription" });
  }
});

/* ------------------ Razorpay Webhook ------------------ */
/**
 * POST /api/razorpay/webhook
 * Verifies signature, activates premium on payment success.
 */
app.post("/api/razorpay/webhook", async (req, res) => {
  try {
    if (!ensureEnvOrRespond(res)) return;

const signature = req.headers["x-razorpay-signature"];
    if (!signature) return res.status(400).send("Missing signature");

const expected = crypto
      .createHmac("sha256", RAZORPAY_WEBHOOK_SECRET)
      .update(req.body)
      .digest("hex");

const sigBuf = Buffer.from(String(signature), "utf8");
    const expBuf = Buffer.from(expected, "utf8");

if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      return res.status(400).send("Invalid signature");
    }

const payload = JSON.parse(req.body.toString("utf8"));
    const event = payload?.event;

// Only process successful payment events
    if (event !== "payment_link.paid" && event !== "payment.captured") {
      return res.status(200).json({ ok: true, ignored: true });
    }

const linkEntity = payload?.payload?.payment_link?.entity || null;
    const paymentEntity = payload?.payload?.payment?.entity || null;

const notes = linkEntity?.notes || paymentEntity?.notes || {};
    const userId = notes.user_id;
    const planCode = notes.plan_code;
    const plan = PLAN_CONFIG[planCode];

if (!userId || !plan) {
      console.warn("Webhook missing user_id or invalid plan_code", { userId, planCode });
      return res.status(200).json({ ok: true, ignored: "missing_notes" });
    }

const razorpayPaymentId = paymentEntity?.id || null;
    const razorpayPaymentLinkId = linkEntity?.id || null;
    const providerPaymentId =
      razorpayPaymentId || razorpayPaymentLinkId || `evt_${payload?.created_at || Date.now()}`;

// Idempotency check
    const { data: existing } = await supabaseAdmin
      .from("subscriptions")
      .select("id")
      .eq("provider", "razorpay")
      .eq("provider_payment_id", providerPaymentId)
      .maybeSingle();

if (existing?.id) {
      return res.status(200).json({ ok: true, duplicate: true });
    }

// Read current expiry to extend correctly if already active
    const { data: profile, error: profileErr } = await supabaseAdmin
      .from("profiles")
      .select("premium_until")
      .eq("id", userId)
      .maybeSingle();

if (profileErr) {
      console.error("profile read error:", profileErr);
    }

const now = new Date();
    const currentUntil = profile?.premium_until ? new Date(profile.premium_until) : null;
    const baseDate = currentUntil && currentUntil > now ? currentUntil : now;
    const newPremiumUntil = addDays(baseDate, plan.durationDays);

// Upsert premium state in profiles
    const { error: upProfileErr } = await supabaseAdmin.from("profiles").upsert(
      {
        id: userId,
        is_premium: true,
        premium_plan: planCode,
        premium_activated_at: now.toISOString(),
        premium_until: newPremiumUntil.toISOString(),
      },
      { onConflict: "id" }
    );

if (upProfileErr) {
      console.error("profile update error:", upProfileErr);
      return res.status(500).json({ message: "Failed profile update" });
    }

// Insert subscription log
    const { error: subErr } = await supabaseAdmin.from("subscriptions").insert({
      user_id: userId,
      provider: "razorpay",
      provider_payment_id: providerPaymentId,
      provider_link_id: razorpayPaymentLinkId,
      plan_code: planCode,
      amount_inr: plan.amountInr,
      status: "active",
      started_at: now.toISOString(),
      ends_at: newPremiumUntil.toISOString(),
      raw_payload: payload,
    });

if (subErr) {
      console.error("subscription insert error:", subErr);
      return res.status(500).json({ message: "Failed subscription insert" });
    }

return res.status(200).json({ ok: true });
  } catch (e) {
    console.error("webhook error:", e);
    return res.status(500).send("Webhook processing failed");
  }
});

/* ------------------ Health ------------------ */
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "prepcode-payments" });
});

/**
 * Vercel serverless export (NO app.listen here)
 */
export default app;
