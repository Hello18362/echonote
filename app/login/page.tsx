import { LoginForm } from "@/components/LoginForm";
import { accessEnabled, safeNext } from "@/lib/access";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "需要口令 · EchoNote",
  robots: { index: false, follow: false },
};

export default function LoginPage({
  searchParams,
}: {
  searchParams: { next?: string; k?: string };
}) {
  return (
    <main className="flex min-h-[100dvh] items-center justify-center px-6">
      <div className="w-full max-w-[340px] rounded-2xl border border-slate-100 bg-white p-7 shadow-card">
        <LoginForm
          next={safeNext(searchParams.next)}
          gateOff={!accessEnabled()}
          autoToken={searchParams.k}
        />
      </div>
    </main>
  );
}
