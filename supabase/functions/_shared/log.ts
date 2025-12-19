function base(fn: string, level: "info" | "error", msg: string, ctx: Record<string, unknown>) {
  const payload = {
    ts: new Date().toISOString(),
    level,
    fn,
    msg,
    ...ctx,
  };
  // Supabase Edge Functions capture stdout/stderr.
  if (level === "error") console.error(JSON.stringify(payload));
  else console.log(JSON.stringify(payload));
}

export function logInfo(fn: string, msg: string, ctx: Record<string, unknown> = {}) {
  base(fn, "info", msg, ctx);
}

export function logError(fn: string, msg: string, ctx: Record<string, unknown> = {}) {
  base(fn, "error", msg, ctx);
}

