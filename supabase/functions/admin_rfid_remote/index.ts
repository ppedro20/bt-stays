import { corsHeaders } from "../_shared/cors.ts";
import { assertAdmin } from "../_shared/adminAuth.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";

type Body = { card_uid?: string; action?: "open" | "block" | "unblock" };

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

  const cardUid = body.card_uid?.trim();
  const action = body.action?.trim();
  if (!cardUid) {
    return new Response(JSON.stringify({ error: "missing_card_uid" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (!action || !["open", "block", "unblock"].includes(action)) {
    return new Response(JSON.stringify({ error: "invalid_action" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { data, error } = await supabaseAdmin.rpc("request_rfid_remote_action", {
    p_card_uid: cardUid,
    p_action: action,
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
      me: { user_id: auth.userId, role: auth.role },
      action: row,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
