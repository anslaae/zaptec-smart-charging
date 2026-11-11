"use client";

// iOS-style switch from the design (51×31, white knob), inside a 44 px tap target.
export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="flex h-11 w-[59px] shrink-0 cursor-pointer items-center justify-end disabled:cursor-not-allowed disabled:opacity-60"
    >
      <span className={`relative h-[31px] w-[51px] rounded-full transition-colors ${checked ? "bg-accent" : "bg-subtle"}`}>
        <span
          className={`absolute top-[2px] h-[27px] w-[27px] rounded-full bg-white shadow transition-all ${
            checked ? "left-[22px]" : "left-[2px]"
          }`}
        />
      </span>
    </button>
  );
}
