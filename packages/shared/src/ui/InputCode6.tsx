import type { InputHTMLAttributes } from "react";

function digitsOnly(value: string) {
  return value.replace(/\D/g, "");
}

export function InputCode6({
  value,
  onChange,
  className,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "onChange" | "value" | "maxLength" | "inputMode"> & {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <input
      {...props}
      className={["bt-input", "bt-input-code6", className].filter(Boolean).join(" ")}
      inputMode="numeric"
      pattern="\\d{6}"
      maxLength={6}
      placeholder={props.placeholder ?? "000000"}
      value={value}
      onChange={(e) => onChange(digitsOnly(e.target.value).slice(0, 6))}
    />
  );
}
