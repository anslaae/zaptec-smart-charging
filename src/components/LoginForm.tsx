"use client";

import { useActionState } from "react";
import { login, type LoginState } from "@/lib/auth/actions";
import { nb } from "@/lib/i18n/nb";

const initialState: LoginState = {};

const inputClass =
  "h-12 rounded-[var(--radius-button)] border border-border bg-surface px-3 text-base text-text outline-none focus:border-accent";

export function LoginForm() {
  const [state, formAction, pending] = useActionState(login, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="email" className="text-sm font-semibold">
          {nb.login.email}
        </label>
        <input id="email" name="email" type="email" required autoComplete="email" className={inputClass} />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="password" className="text-sm font-semibold">
          {nb.login.password}
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
          className={inputClass}
        />
      </div>
      {state.error && <p className="text-sm text-red">{state.error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="h-[52px] cursor-pointer rounded-[var(--radius-button)] bg-accent px-4 text-base font-semibold text-on-accent disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? nb.login.submitting : nb.login.submit}
      </button>
    </form>
  );
}
