import { corsHeaders } from "../_shared/cors.ts";
import { assertAdmin } from "../_shared/adminAuth.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";

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

  const cards = await supabaseAdmin
    .from("admin_rfid_cards")
    .select("*")
    .order("updated_at", { ascending: false })
    .limit(200);

  if (cards.error) {
    return new Response(JSON.stringify({ error: cards.error.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const logs = await supabaseAdmin.from("admin_rfid_logs").select("*");
  if (logs.error) {
    return new Response(JSON.stringify({ error: logs.error.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(
    JSON.stringify({
      ok: true,
      me: { user_id: auth.userId, role: auth.role },
      cards: cards.data,
      logs: logs.data,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
