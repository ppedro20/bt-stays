import { supabaseAdmin } from "./supabaseAdmin.ts";

function getBearerToken(req: Request): string | null {
  const header = req.headers.get("authorization");
  if (!header) return null;
  const [kind, token] = header.split(" ");
  if (kind?.toLowerCase() !== "bearer" || !token) return null;
  return token.trim();
}

export async function assertAdmin(req: Request) {
  const token = getBearerToken(req);
  if (!token) return { ok: false as const, error: "missing_bearer_token" };

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data.user) return { ok: false as const, error: "invalid_token" };

  const adminRow = await supabaseAdmin
    .from("admins")
    .select("role, active")
    .eq("user_id", data.user.id)
    .maybeSingle();

  if (adminRow.error) return { ok: false as const, error: "admin_lookup_failed" };
  if (!adminRow.data?.active) return { ok: false as const, error: "not_admin" };

  return { ok: true as const, userId: data.user.id, role: adminRow.data.role as string };
}

export async function assertSuperadmin(req: Request) {
  const admin = await assertAdmin(req);
  if (!admin.ok) return admin;
  if (admin.role !== "superadmin") return { ok: false as const, error: "not_superadmin" };
  return admin;
}
