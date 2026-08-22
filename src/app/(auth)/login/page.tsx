import { LoginForm } from "@/features/auth/LoginForm";
import Image from "next/image";
import { APP_LOGO_NEGATIVE_SRC, APP_LOGO_SRC, APP_NAME } from "@/constants/brand";

export default function LoginPage() {
  return (
    <main className="grid min-h-screen bg-slate-950 lg:grid-cols-[1.1fr_0.9fr]">
      <section className="hidden flex-col justify-between bg-gradient-to-br from-slate-950 via-slate-900 to-blue-950 p-12 text-white lg:flex relative overflow-hidden">
        {/* Abstract background elements */}
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
            Operação comercial, fiscal e financeira em uma interface moderna.
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-8 text-slate-300">
            Sistema de Gestão Empresarial integrado e seguro, desenvolvido para escalar com o seu negócio.
          </p>
        </div>

        <div className="grid grid-cols-3 gap-4 text-sm text-slate-300 relative z-10">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur-sm transition hover:bg-white/10">
            <h3 className="font-semibold text-white mb-1">Acesso Seguro</h3>
            <p className="text-slate-400 text-xs">Acesso protegido.</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur-sm transition hover:bg-white/10">
            <h3 className="font-semibold text-white mb-1">Multiempresa</h3>
            <p className="text-slate-400 text-xs">Gerencie diversas filiais.</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur-sm transition hover:bg-white/10">
            <h3 className="font-semibold text-white mb-1">Visão 360º</h3>
            <p className="text-slate-400 text-xs">Métricas em tempo real.</p>
          </div>
        </div>
      </section>

      <section className="flex items-center justify-center bg-slate-50 p-6 relative">
        <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 shadow-xl shadow-slate-900/5 relative z-10">
          <div className="mb-8 text-center lg:text-left">
            <div className="mb-6 flex justify-center lg:hidden">
              <Image
                src={APP_LOGO_SRC}
                alt={APP_NAME}
                width={140}
                height={52}
                className="object-contain"
              />
            </div>
            <h2 className="text-3xl font-bold text-slate-950">Acesso ao {APP_NAME}</h2>
            <p className="mt-2 text-sm text-slate-500">
              Entre com suas credenciais para acessar o sistema.
            </p>
          </div>

          <LoginForm />
        </div>
      </section>
    </main>
  );
}
