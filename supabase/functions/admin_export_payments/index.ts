import { corsHeaders } from "../_shared/cors.ts";
import { assertAdmin } from "../_shared/adminAuth.ts";
import { toCsv } from "../_shared/csv.ts";
import { logError, logInfo } from "../_shared/log.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";

type Body = { status?: string; since?: string; until?: string; limit?: number };

const FN = "admin_export_payments";

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID();
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json", "x-request-id": requestId },
    });
  }

  const auth = await assertAdmin(req);
  if (!auth.ok) {
    logInfo(FN, "unauthorized", { requestId, error: auth.error });
    return new Response(JSON.stringify({ error: auth.error }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json", "x-request-id": requestId },
    });
  }

  let body: Body = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const limit = Math.max(1, Math.min(body.limit ?? 2000, 10000));
  let q = supabaseAdmin.from("admin_payments").select("*").order("created_at", { ascending: false }).limit(limit);
  if (body.status) q = q.eq("status", body.status);
  if (body.since) q = q.gte("created_at", body.since);
  if (body.until) q = q.lte("created_at", body.until);

  const { data, error } = await q;
  if (error) {
    logError(FN, "query_failed", { requestId, userId: auth.userId, err: error.message });
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json", "x-request-id": requestId },
    });
  }

  const csv = toCsv(data ?? [], [
    "payment_id",
    "status",
    "created_at",
    "paid_at",
    "canceled_at",
    "product_code",
    "validity_hours",
    "amount_cents",
    "currency",
    "access_code_id",
    "confirmed_via",
    "confirmed_at",
    "provider",
    "provider_payment_id",
    "provider_status",
  ]);

  logInfo(FN, "export_ok", { requestId, userId: auth.userId, role: auth.role, rows: data?.length ?? 0 });

  return new Response(csv, {
    headers: {
      ...corsHeaders,
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename=\"payments.csv\"`,
      "x-request-id": requestId,
    },
  });
});

