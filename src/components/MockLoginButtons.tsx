import { MOCK_MODE } from "@/lib/mock/mode";
import { MOCK_USERS } from "@/lib/mock/seed";
import { mockLogin } from "@/lib/mock/actions";

/** One-click login as a seeded household member, mock mode only. */
export function MockLoginButtons() {
  if (!MOCK_MODE) return null;
  return (
    <div className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-amber-border bg-amber-bg p-4">
      <p className="text-sm font-semibold text-amber">Mock-modus: logg inn som</p>
      <div className="grid grid-cols-2 gap-2">
        {MOCK_USERS.map((user) => (
          <form key={user.id} action={mockLogin.bind(null, user.id)}>
            <button
              type="submit"
              className="flex h-12 w-full cursor-pointer items-center justify-center rounded-[var(--radius-button)] border border-border bg-surface text-[15px] font-semibold"
            >
              {user.name}
            </button>
          </form>
        ))}
      </div>
    </div>
  );
}
