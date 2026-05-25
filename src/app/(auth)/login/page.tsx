import { LoginForm } from "@/features/auth/LoginForm";

export default function LoginPage() {
  return (
    <main className="grid min-h-screen bg-slate-950 lg:grid-cols-[1.1fr_0.9fr]">
      <section className="hidden flex-col justify-between bg-gradient-to-br from-slate-950 via-slate-900 to-blue-950 p-12 text-white lg:flex">
        <div>
          <div className="mb-16 inline-flex items-center rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm text-blue-100">
            ERP Ideal Mockado
          </div>
          <h1 className="max-w-2xl text-5xl font-bold tracking-tight">
            Operacao comercial, fiscal e financeira em uma interface moderna.
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-8 text-slate-300">
            Primeira versao navegavel para validar layout, navegacao e produtividade antes de
            conectar dados reais.
          </p>
        </div>

        <div className="grid grid-cols-3 gap-4 text-sm text-slate-300">
          <div className="rounded-2xl border border-white/10 bg-white/10 p-4">
            Login mockado
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/10 p-4">
            Multiempresa
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/10 p-4">
            Dashboard inicial
          </div>
        </div>
      </section>

      <section className="flex items-center justify-center bg-slate-50 p-6">
        <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 shadow-xl shadow-slate-900/5">
          <div className="mb-8">
            <p className="text-sm font-semibold uppercase tracking-[0.24em] text-blue-600">
              Acesso ao ERP
            </p>
            <h2 className="mt-3 text-3xl font-bold text-slate-950">Entrar</h2>
            <p className="mt-2 text-sm text-slate-500">
              Use o acesso preenchido para entrar na versao visual mockada.
            </p>
          </div>

          <LoginForm />
        </div>
      </section>
    </main>
  );
}
