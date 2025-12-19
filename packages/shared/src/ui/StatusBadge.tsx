export type BadgeTone = "neutral" | "success" | "danger";

export function StatusBadge({ tone = "neutral", text }: { tone?: BadgeTone; text: string }) {
  const cls =
    tone === "success" ? "bt-badge-success" : tone === "danger" ? "bt-badge-danger" : "bt-badge-neutral";
  return <span className={["bt-badge", cls].join(" ")}>{text}</span>;
}
