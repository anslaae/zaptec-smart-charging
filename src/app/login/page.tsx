import { LoginForm } from "@/components/LoginForm";
import { MockLoginButtons } from "@/components/MockLoginButtons";
import { nb } from "@/lib/i18n/nb";

export default function LoginPage() {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-6 py-12">
      <div>
        <h1 className="text-[28px] font-bold">{nb.app.name}</h1>
        <p className="text-sm text-muted">{nb.login.subtitle}</p>
      </div>
      <MockLoginButtons />
      <LoginForm />
    </main>
  );
}
