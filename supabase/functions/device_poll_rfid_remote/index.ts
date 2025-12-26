import { corsHeaders } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";

type Body = { device_id?: string };

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

  const deviceId = body.device_id?.trim() || null;
  const { data, error } = await supabaseAdmin.rpc("claim_rfid_remote_action", { p_device_id: deviceId });
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const row = data?.[0] ?? null;
  return new Response(
    JSON.stringify({
      ok: true,
      action: row
        ? {
            action_id: row.action_id,
            card_uid: row.card_uid,
            action: row.action,
            keycard: row.keycard,
          }
        : null,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
