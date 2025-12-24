import { corsHeaders } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";

type Body = { card_uid?: string };

function unauthorized(): Response {
  return new Response(JSON.stringify({ error: "unauthorized" }), {
    status: 401,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const deviceSecret = req.headers.get("x-device-secret");
  if (!deviceSecret || deviceSecret !== Deno.env.get("DEVICE_SECRET")) {
    return unauthorized();
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
  if (!cardUid) {
    return new Response(JSON.stringify({ error: "missing_card_uid" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { data, error } = await supabaseAdmin.rpc("consume_rfid", { p_card_uid: cardUid });
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
      granted: row.granted,
      reason: row.reason,
      valid_until: row.valid_until,
      access_code_id: row.access_code_id,
      card_uid: row.card_uid,
      keycard: row.keycard,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
