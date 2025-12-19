import { corsHeaders } from "../_shared/cors.ts";
import { assertAdmin } from "../_shared/adminAuth.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";

type Body = { code_id?: string };

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

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid_json" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const codeId = body.code_id?.trim();
  if (!codeId) {
    return new Response(JSON.stringify({ error: "missing_code_id" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const code = await supabaseAdmin.from("admin_codes").select("*").eq("code_id", codeId).maybeSingle();
  if (code.error) {
    return new Response(JSON.stringify({ error: code.error.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (!code.data) {
    return new Response(JSON.stringify({ error: "not_found" }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const purchaseId = code.data.purchase_id as string;

  const events = await supabaseAdmin
    .from("events_timeline")
    .select("*")
    .or(
      `and(entity_type.eq.access_code,entity_id.eq.${codeId}),and(entity_type.eq.payment,entity_id.eq.${purchaseId})`,
    )
    .order("created_at", { ascending: true })
    .limit(500);

  if (events.error) {
    return new Response(JSON.stringify({ error: events.error.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(
    JSON.stringify({
      ok: true,
      me: { user_id: auth.userId, role: auth.role },
      code: code.data,
      events: events.data,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
