"use client";

import Image from "next/image";
import { CheckCircle2, Clock, LogOut } from "lucide-react";
import { APP_LOGO_NEGATIVE_SRC, APP_LOGO_SRC, APP_NAME } from "@/constants/brand";
import { useAuth } from "@/features/auth/AuthProvider";
import { useRouter } from "next/navigation";

export default function BoasVindasPage() {
  const router = useRouter();
  const { logout, user } = useAuth();

  async function handleLogout() {
    await logout();
    router.replace("/login");
  }

  return (
    <main className="grid min-h-screen bg-slate-950 lg:grid-cols-[1.1fr_0.9fr]">
      <section className="hidden flex-col justify-between bg-gradient-to-br from-slate-950 via-slate-900 to-blue-950 p-12 text-white lg:flex relative overflow-hidden">
        <div className="absolute -top-40 -right-40 h-[600px] w-[600px] rounded-full bg-blue-500/10 blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 left-0 h-[400px] w-[400px] rounded-full bg-purple-500/10 blur-3xl pointer-events-none" />

        <div className="relative z-10">
          <div className="mb-12">
            <Image
              src={APP_LOGO_NEGATIVE_SRC}
              alt={APP_NAME}
              width={160}
              height={59}
              className="object-contain"
              priority
            />
          </div>
          <h1 className="max-w-2xl text-5xl font-bold tracking-tight leading-tight">
            Seja bem-vindo(a) ao {APP_NAME}.
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-8 text-slate-300">
            A operação comercial, fiscal e financeira em um só lugar.
          </p>
        </div>
      </section>

      <section className="flex items-center justify-center bg-slate-50 p-6 relative">
        <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 shadow-xl shadow-slate-900/5 relative z-10 text-center">
          
          <div className="mb-8 flex justify-center lg:hidden">
            <Image
              src={APP_LOGO_SRC}
              alt={APP_NAME}
              width={140}
              height={52}
              className="object-contain"
            />
          </div>

          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-green-100 mb-6">
            <CheckCircle2 className="h-8 w-8 text-green-600" />
          </div>
          
          <h2 className="text-2xl font-bold text-slate-950 mb-2">E-mail confirmado com sucesso</h2>
          
          <p className="text-sm text-slate-600 mb-6">
            Seu cadastro foi recebido e a verificação do e-mail foi concluída.
          </p>

          <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 mb-8 text-left flex gap-3">
            <Clock className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="text-sm font-bold text-amber-900 mb-1">Aguardando aprovação</h3>
              <p className="text-xs text-amber-800 leading-relaxed">
                O administrador precisa liberar o seu perfil de acesso antes que você possa utilizar o sistema. Você será notificado ou poderá tentar fazer login novamente mais tarde.
              </p>
            </div>
          </div>

          {user ? (
            <button
              onClick={handleLogout}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800"
            >
              <LogOut className="h-4 w-4" />
              Sair e voltar ao login
            </button>
          ) : (
            <button
              onClick={() => router.replace("/login")}
              className="inline-block w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800"
            >
              Voltar ao login
            </button>
          )}

        </div>
      </section>
    </main>
  );
}
