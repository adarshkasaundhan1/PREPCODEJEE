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

app.use(
  cors({
    origin: process.env.APP_ORIGIN || true,
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
  starter_monthly: { amountInr: 149, durationDays: 30, name: "Starter Monthly" },
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
        app: "prepcore",
      },
    });

return res.json({
      checkoutUrl: paymentLink.short_url,
    });
  } catch (e) {
    console.error("create-checkout error:", e);
    return res.status(500).json({ message: "Failed to create checkout" });
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

const sigBuf = Buffer.from(signature, "utf8");
    const expBuf = Buffer.from(expected, "utf8");
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      return res.status(400).send("Invalid signature");
    }

const payload = JSON.parse(req.body.toString("utf8"));
    const event = payload.event;

// We care about successful payment link completion
    if (event !== "payment_link.paid" && event !== "payment.captured") {
      return res.status(200).json({ ok: true, ignored: true });
    }

const linkEntity = payload?.payload?.payment_link?.entity || null;
    const paymentEntity = payload?.payload?.payment?.entity || null;

// For payment.captured, payment_link may be absent
    const notes = linkEntity?.notes || paymentEntity?.notes || {};
    const userId = notes.user_id;
    const planCode = notes.plan_code;
    const plan = PLAN_CONFIG[planCode];

if (!userId || !plan) {
      console.warn("Webhook missing user_id or invalid plan_code", { userId, planCode });
      return res.status(200).json({ ok: true, ignored: "missing_notes" });
    }

const providerPaymentId =
      paymentEntity?.id ||
      linkEntity?.id ||
      `evt_${payload?.created_at || Date.now()}`;

// idempotency: skip if already recorded
    const { data: existing } = await supabaseAdmin
      .from("subscriptions")
      .select("id")
      .eq("provider", "razorpay")
      .eq("provider_payment_id", providerPaymentId)
      .maybeSingle();

if (existing?.id) {
      return res.status(200).json({ ok: true, duplicate: true });
    }

// Fetch current premium_until to extend from existing expiry if still active
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

// Update profile premium state
    const { error: upProfileErr } = await supabaseAdmin.from("profiles").upsert(
      {
        id: userId,
        is_premium: true,
        premium_plan: planCode,
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
      plan_code: planCode,
      amount_inr: plan.amountInr,
      status: "active",
      started_at: now.toISOString(),
      ends_at: newPremiumUntil.toISOString(),
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
  res.json({ ok: true, service: "prepcore-payments" });
});

/**
 * Vercel serverless export (NO app.listen here)
 */
export default app;
