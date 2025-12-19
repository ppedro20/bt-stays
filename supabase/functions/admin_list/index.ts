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

  const codes = await supabaseAdmin
    .from("admin_codes")
    .select("*")
    .order("issued_at", { ascending: false })
    .limit(200);

  if (codes.error) {
    return new Response(JSON.stringify({ error: codes.error.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const audit = await supabaseAdmin.from("admin_audit_recent").select("*");
  if (audit.error) {
    return new Response(JSON.stringify({ error: audit.error.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(
    JSON.stringify({
      ok: true,
      me: { user_id: auth.userId, role: auth.role },
      codes: codes.data,
      audit: audit.data,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
