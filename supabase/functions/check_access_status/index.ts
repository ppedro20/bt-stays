import { corsHeaders } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { rateLimit } from "../_shared/rateLimit.ts";

type Body = { code?: string };

function getClientIp(req: Request): string {
  const cf = req.headers.get("cf-connecting-ip");
  if (cf) return cf;
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]?.trim() ?? "unknown";
  return "unknown";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const ip = getClientIp(req);
  const rl = rateLimit(`check_access_status:${ip}`, 30, 60_000);
  if (!rl.ok) {
    return new Response(JSON.stringify({ error: "rate_limited" }), {
      status: 429,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
        "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)),
      },
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

  const code = body.code?.trim();
  if (!code) {
    return new Response(JSON.stringify({ error: "missing_code" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { data, error } = await supabaseAdmin.rpc("check_access_status", { p_code: code });
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
      server_time: new Date().toISOString(),
      status: {
        state: row.state,
        can_access: row.can_access,
        valid_until: row.valid_until,
      },
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
