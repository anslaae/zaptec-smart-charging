import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/dal";
import { OpelLinkTester } from "@/components/OpelLinkTester";

// Test bench for opening the myOpel app from this web app -- try each
// candidate link on a real phone to see which one actually opens the app
// (rather than the store page). Not linked from the main nav; reachable from
// the debug bar (?debug=1) or by URL. Sends no charger commands.
export default async function OpelLinkTestPage() {
  await getCurrentUser();

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col gap-6 px-6 py-8">
      <div>
        <Link href="/" className="text-sm text-black/50 underline underline-offset-2 dark:text-white/50">
          ← Back
        </Link>
        <h1 className="mt-2 text-xl font-semibold">Test: open myOpel</h1>
      </div>
      <OpelLinkTester />
    </main>
  );
}
