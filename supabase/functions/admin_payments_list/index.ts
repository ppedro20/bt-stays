import { corsHeaders } from "../_shared/cors.ts";
import { assertAdmin } from "../_shared/adminAuth.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";

type Body = { status?: string; since?: string; until?: string; limit?: number };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const auth = await assertAdmin(req);
  if (!auth.ok) {
    return new Response(JSON.stringify({ error: auth.error }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: Body = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const limit = Math.max(1, Math.min(body.limit ?? 200, 500));
  let query = supabaseAdmin.from("admin_payments").select("*").order("created_at", { ascending: false }).limit(limit);

  if (body.status) query = query.eq("status", body.status);
  if (body.since) query = query.gte("created_at", body.since);
  if (body.until) query = query.lte("created_at", body.until);

  const { data, error } = await query;
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ ok: true, me: { user_id: auth.userId, role: auth.role }, payments: data }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
