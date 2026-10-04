import { logout } from "@/lib/auth/actions";

export function LogoutButton() {
  return (
    <form action={logout}>
      <button type="submit" className="text-sm text-black/60 hover:underline dark:text-white/60">
        Sign out
      </button>
    </form>
  );
}
