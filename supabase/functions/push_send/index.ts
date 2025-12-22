import webpush from "npm:web-push@3.6.7";
import { corsHeaders } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { logError, logInfo } from "../_shared/log.ts";

type Body = {
  title?: string;
  body?: string;
  url?: string;
  tag?: string;
};

Deno.serve(async (req) => {
  try {
    const requestId = crypto.randomUUID();
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    if (req.method !== "POST") {
      logInfo("push_send", "method_not_allowed", { requestId, method: req.method });
      return new Response(JSON.stringify({ error: "method_not_allowed" }), {
        status: 405,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminSecret = Deno.env.get("PUSH_ADMIN_SECRET");
    if (!adminSecret) {
      return new Response(JSON.stringify({ error: "push_admin_secret_missing" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const provided = req.headers.get("x-admin-secret");
    if (!provided || provided !== adminSecret) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const vapidPublic = Deno.env.get("VAPID_PUBLIC_KEY");
    const vapidPrivate = Deno.env.get("VAPID_PRIVATE_KEY");
    const vapidSubject = Deno.env.get("VAPID_SUBJECT") ?? "mailto:admin@example.com";
    if (!vapidPublic || !vapidPrivate) {
      return new Response(JSON.stringify({ error: "vapid_keys_missing" }), {
        status: 500,
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

    const title = body.title?.trim() || "bt-stays";
    const notificationBody = body.body?.trim() || "";
    const payload = JSON.stringify({
      title,
      body: notificationBody,
      data: { url: body.url ?? "/" },
      tag: body.tag ?? "bt-stays",
    });

    webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);

    const { data: subs, error } = await supabaseAdmin
      .from("push_subscriptions")
      .select("endpoint,p256dh,auth")
      .eq("active", true);

    if (error) {
      logError("push_send", "select_failed", { requestId, err: error.message });
      return new Response(JSON.stringify({ error: error.message }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let sent = 0;
    let failed = 0;
    for (const sub of subs ?? []) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload,
        );
        sent += 1;
      } catch (err) {
        failed += 1;
        const status = err?.statusCode ?? err?.status ?? null;
        if (status === 404 || status === 410) {
          await supabaseAdmin
            .from("push_subscriptions")
            .update({ active: false, updated_at: new Date().toISOString() })
            .eq("endpoint", sub.endpoint);
        } else {
          logError("push_send", "send_failed", { requestId, status, err: String(err?.body ?? err) });
        }
      }
    }

    logInfo("push_send", "send_complete", { requestId, sent, failed });
    return new Response(JSON.stringify({ ok: true, sent, failed }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    logError("push_send", "unhandled_error", { err: e instanceof Error ? e.message : String(e) });
    return new Response(JSON.stringify({ error: "internal_error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
