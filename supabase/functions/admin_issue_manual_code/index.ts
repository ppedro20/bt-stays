import { corsHeaders } from "../_shared/cors.ts";
import { assertSuperadmin } from "../_shared/adminAuth.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";

type Body = { validity_hours?: number; note?: string };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const auth = await assertSuperadmin(req);
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
    // optional body
  }

  const validityHours = body.validity_hours ?? 24;
  const note = body.note ?? null;

  const { data, error } = await supabaseAdmin.rpc("issue_manual_code", {
    p_validity_hours: validityHours,
    p_note: note,
    p_actor_id: auth.userId,
  });

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const row = data?.[0];
  if (!row) {
    return new Response(JSON.stringify({ error: "empty_result" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(
    JSON.stringify({
      ok: true,
      result: {
        purchase_id: row.payment_id,
        code_id: row.access_code_id,
        access_code: row.access_code,
        valid_until: row.valid_until,
      },
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});

