import type { ReactNode, TableHTMLAttributes } from "react";

export function Table({
  className,
  ...props
}: TableHTMLAttributes<HTMLTableElement> & { children: ReactNode }) {
  return <table {...props} className={["bt-table", className].filter(Boolean).join(" ")} />;
}
