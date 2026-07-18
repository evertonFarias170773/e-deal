"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Mail, ArrowLeft, CheckCircle2 } from "lucide-react";
import { getSupabaseClient } from "@/lib/supabase/client";

export default function EsqueciMinhaSenhaPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const client = getSupabaseClient();
      if (!client) {
        throw new Error("Cliente Supabase não inicializado.");
      }

      const { error: resetError } = await client.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
        redirectTo: `${window.location.origin}/auth/callback?next=/atualizar-senha`,
      });

      if (resetError) {
        throw new Error(resetError.message || "Não foi possível processar sua solicitação.");
      }

      setSuccess(true);
    } catch (currentError) {
      setError(
        currentError instanceof Error
          ? currentError.message
          : "Erro inesperado ao solicitar recuperação."
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="grid min-h-screen bg-slate-950 lg:grid-cols-[1.1fr_0.9fr]">
      <section className="hidden flex-col justify-between bg-gradient-to-br from-slate-950 via-slate-900 to-blue-950 p-12 text-white lg:flex">
        <div>
          <div className="mb-16 inline-flex items-center rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm text-blue-100">
            ERP Ideal
          </div>
          <h1 className="max-w-2xl text-5xl font-bold tracking-tight">
            Operacao comercial, fiscal e financeira em uma interface moderna.
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-8 text-slate-300">
            Sistema de Gestão Empresarial integrado e seguro.
          </p>
        </div>

        <div className="grid grid-cols-3 gap-4 text-sm text-slate-300">
          <div className="rounded-2xl border border-white/10 bg-white/10 p-4">
            Acesso Seguro
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
            <Link href="/login" className="inline-flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-slate-700 mb-6 transition">
              <ArrowLeft className="h-4 w-4" />
              Voltar ao login
            </Link>
            <p className="text-sm font-semibold uppercase tracking-[0.24em] text-blue-600">
              Recuperação
            </p>
            <h2 className="mt-3 text-3xl font-bold text-slate-950">Esqueci minha senha</h2>
            {!success && (
              <p className="mt-2 text-sm text-slate-500">
                Informe o seu e-mail cadastrado e enviaremos as instruções para redefinição.
              </p>
            )}
          </div>

          {success ? (
            <div className="flex flex-col items-center justify-center text-center space-y-4 py-4">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-100 text-green-600">
                <CheckCircle2 className="h-8 w-8" />
              </div>
              <h3 className="text-lg font-semibold text-slate-900">E-mail enviado!</h3>
              <p className="text-sm text-slate-600">
                Se este e-mail estiver cadastrado, você receberá um link para criar uma nova senha.
                Verifique também sua caixa de spam.
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700" htmlFor="email">
                  E-mail
                </label>
                <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
                  <Mail className="h-4 w-4 text-slate-400" />
                  <input
                    id="email"
                    type="email"
                    required
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    className="w-full border-0 bg-transparent text-sm text-slate-900 outline-none"
                    placeholder="seu.email@empresa.com.br"
                  />
                </div>
              </div>

              {error ? (
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {error}
                </div>
              ) : null}

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-60"
              >
                {isSubmitting ? "Enviando..." : "Enviar link de recuperação"}
              </button>
            </form>
          )}
        </div>
      </section>
    </main>
  );
}
