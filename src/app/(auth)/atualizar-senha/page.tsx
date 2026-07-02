"use client";

import { FormEvent, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { LockKeyhole } from "lucide-react";
import { getSupabaseClient } from "@/lib/supabase/client";

export default function AtualizarSenhaPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  
  // Supabase automatically parses the hash/code in the URL and establishes a session for password recovery.
  // We just need to check if there is an error in the URL (e.g., link expired).
  useEffect(() => {
    const hash = window.location.hash;
    const search = window.location.search;
    const urlParams = new URLSearchParams(search || hash.replace("#", "?"));
    const errorDescription = urlParams.get("error_description");
    
    if (errorDescription) {
      setError(decodeURIComponent(errorDescription));
    }
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError("As senhas não coincidem.");
      return;
    }

    if (password.length < 6) {
      setError("A senha deve ter pelo menos 6 caracteres.");
      return;
    }

    setIsSubmitting(true);

    try {
      const client = getSupabaseClient();
      if (!client) {
        throw new Error("Cliente Supabase não inicializado.");
      }

      const { error: updateError } = await client.auth.updateUser({
        password: password,
      });

      if (updateError) {
        throw new Error(updateError.message || "Não foi possível atualizar a senha.");
      }

      setSuccess(true);
      // Aguarda uns segundos e redireciona para login (ou dashboard)
      setTimeout(() => {
        router.replace("/login");
      }, 3000);
    } catch (currentError) {
      setError(
        currentError instanceof Error
          ? currentError.message
          : "Erro inesperado ao atualizar a senha."
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
      </section>

      <section className="flex items-center justify-center bg-slate-50 p-6">
        <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 shadow-xl shadow-slate-900/5">
          <div className="mb-8">
            <p className="text-sm font-semibold uppercase tracking-[0.24em] text-blue-600">
              Segurança
            </p>
            <h2 className="mt-3 text-3xl font-bold text-slate-950">Criar nova senha</h2>
            {!success && (
              <p className="mt-2 text-sm text-slate-500">
                Por favor, insira sua nova senha abaixo.
              </p>
            )}
          </div>

          {success ? (
            <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-4 text-sm text-green-800 text-center">
              <p className="font-semibold mb-2">Senha atualizada com sucesso!</p>
              <p>Você será redirecionado para o login em instantes...</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700" htmlFor="password">
                  Nova Senha
                </label>
                <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
                  <LockKeyhole className="h-4 w-4 text-slate-400" />
                  <input
                    id="password"
                    type="password"
                    required
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    className="w-full border-0 bg-transparent text-sm text-slate-900 outline-none"
                    placeholder="Mínimo de 6 caracteres"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700" htmlFor="confirmPassword">
                  Confirmar Nova Senha
                </label>
                <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
                  <LockKeyhole className="h-4 w-4 text-slate-400" />
                  <input
                    id="confirmPassword"
                    type="password"
                    required
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    className="w-full border-0 bg-transparent text-sm text-slate-900 outline-none"
                    placeholder="Repita a senha"
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
                {isSubmitting ? "Salvando..." : "Salvar nova senha"}
              </button>
            </form>
          )}
        </div>
      </section>
    </main>
  );
}
