import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Loader2 } from "lucide-react";

type Variant = "primary" | "secondary" | "ghost" | "danger";

const variants: Record<Variant, string> = {
  primary: "bg-brand-500 text-white hover:bg-brand-600 disabled:bg-brand-500/50",
  secondary: "bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 disabled:opacity-50",
  ghost: "text-slate-600 hover:bg-slate-100 disabled:opacity-50",
  danger: "text-red-600 hover:bg-red-50 disabled:opacity-50",
};

export function Button({
  variant = "primary",
  loading,
  className = "",
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; loading?: boolean }) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors cursor-pointer disabled:cursor-not-allowed ${variants[variant]} ${className}`}
      disabled={disabled || loading}
      {...rest}
    >
      {loading && <Loader2 className="size-4 animate-spin" />}
      {children}
    </button>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-slate-200 bg-white p-5 ${className}`}>{children}</div>;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </div>
  );
}

export function ErrorText({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
      {error instanceof Error ? error.message : String(error)}
    </p>
  );
}

export function Spinner() {
  return (
    <div className="flex justify-center py-12">
      <Loader2 className="size-6 animate-spin text-slate-400" />
    </div>
  );
}

export function Label({ children, hint }: { children: ReactNode; hint?: string }) {
  return (
    <label className="mb-1.5 block text-sm font-medium text-slate-700">
      {children}
      {hint && <span className="ml-1 font-normal text-slate-400">{hint}</span>}
    </label>
  );
}

export function LinkedinIcon({ className = "size-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.86 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 1 1 0-4.13 2.06 2.06 0 0 1 0 4.13zM7.12 20.45H3.56V9h3.56v11.45zM22.22 0H1.77C.79 0 0 .77 0 1.73v20.54C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.73V1.73C24 .77 23.2 0 22.22 0z" />
    </svg>
  );
}

export const inputBaseCls =
  "rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100";

export const inputCls =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100";
