import type { ButtonHTMLAttributes, ReactNode } from "react";

export type ButtonVariant = "primary" | "danger" | "ghost";

export function Button({
  variant = "ghost",
  children,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; children: ReactNode }) {
  const variantClass =
    variant === "primary" ? "bt-btn-primary" : variant === "danger" ? "bt-btn-danger" : "bt-btn-ghost";
  const merged = ["bt-btn", variantClass, className].filter(Boolean).join(" ");
  return (
    <button {...props} className={merged}>
      {children}
    </button>
  );
}
