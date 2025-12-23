import { corsHeaders } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { logError, logInfo } from "../_shared/log.ts";

type Body = {
  event_id?: string;
  event_type?: string;
};

function json(res: unknown, status = 200) {
  return new Response(JSON.stringify(res), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID();
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    logInfo("email_enqueue", "method_not_allowed", { requestId, method: req.method });
    return json({ error: "method_not_allowed" }, 405);
  }

  const enqueueSecret = Deno.env.get("ENQUEUE_SECRET");
  if (!enqueueSecret) {
    logError("email_enqueue", "not_configured", { requestId });
    return json({ error: "not_configured" }, 501);
  }

  const provided = req.headers.get("x-enqueue-secret");
  if (!provided || provided !== enqueueSecret) {
    logError("email_enqueue", "unauthorized", { requestId });
    return json({ error: "unauthorized" }, 401);
  }

  let body: Body;
  try {
    body = await req.json();
  } catch {
    logInfo("email_enqueue", "invalid_json", { requestId });
    return json({ error: "invalid_json" }, 400);
  }

  const eventId = body.event_id?.trim();
  const eventType = body.event_type?.trim();
  if (!eventId || !eventType) {
    logInfo("email_enqueue", "missing_fields", { requestId });
    return json({ error: "missing_fields" }, 400);
  }

  const { error } = await supabaseAdmin
    .from("email_jobs")
    .upsert({ job_id: eventId, event_type: eventType }, { onConflict: "job_id", ignoreDuplicates: true });

  if (error) {
    logError("email_enqueue", "insert_failed", { requestId, err: error.message });
    return json({ error: "insert_failed" }, 400);
  }

  logInfo("email_enqueue", "accepted", { requestId, eventId, eventType });
  return json({ ok: true });
});
