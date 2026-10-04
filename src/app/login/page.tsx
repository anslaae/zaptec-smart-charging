import { LoginForm } from "@/components/LoginForm";

export default function LoginPage() {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-6 py-12">
      <div>
        <h1 className="text-xl font-semibold">Smart Charging</h1>
        <p className="text-sm text-black/50 dark:text-white/50">Sign in to continue.</p>
      </div>
      <LoginForm />
    </main>
  );
}
