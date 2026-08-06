"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { LockKeyhole, Mail, User, CheckCircle2 } from "lucide-react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { APP_LOGO_SRC, APP_NAME } from "@/constants/brand";

export default function CadastroPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    
    if (password !== confirmPassword) {
      setError("As senhas não conferem.");
      return;
    }
    if (password.length < 6) {
      setError("A senha deve ter no mínimo 6 caracteres.");
      return;
    }

    setIsSubmitting(true);

    try {
      const supabase = getSupabaseClient();
      if (!supabase) {
        throw new Error("Supabase client não está configurado.");
      }

      const origin = typeof window !== "undefined" ? window.location.origin : "";
      
      const { data, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: name,
          },
          emailRedirectTo: `${origin}/auth/callback?next=/boas-vindas`,
        },
      });

      if (signUpError) {
        throw signUpError;
      }
      
      setIsSuccess(true);
      
    } catch (currentError) {
      setError(
        currentError instanceof Error
          ? currentError.message
          : "Nao foi possivel criar o cadastro. Tente novamente."
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="grid min-h-screen bg-slate-950 lg:grid-cols-[1.1fr_0.9fr]">
      <section className="hidden flex-col justify-between bg-gradient-to-br from-slate-950 via-slate-900 to-blue-950 p-12 text-white lg:flex relative overflow-hidden">
        <div className="absolute -top-40 -right-40 h-[600px] w-[600px] rounded-full bg-blue-500/10 blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 left-0 h-[400px] w-[400px] rounded-full bg-purple-500/10 blur-3xl pointer-events-none" />

        <div className="relative z-10">
          <div className="mb-12">
            {/* Wordmark navy — precisa de fundo claro sobre o painel escuro */}
            <div className="inline-flex items-center rounded-xl bg-white px-3 py-2">
              <Image
                src={APP_LOGO_SRC}
                alt={APP_NAME}
                width={160}
                height={59}
                className="object-contain"
                priority
              />
            </div>
          </div>
          <h1 className="max-w-2xl text-5xl font-bold tracking-tight leading-tight">
            Gestão inteligente e segura para sua empresa.
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-8 text-slate-300">
            Crie sua conta para acessar a operação comercial, fiscal e financeira em um só lugar.
          </p>
        </div>
      </section>

      <section className="flex items-center justify-center bg-slate-50 p-6 relative">
        <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 shadow-xl shadow-slate-900/5 relative z-10">
          
          <div className="mb-6 flex justify-center lg:hidden">
            <Image
              src={APP_LOGO_SRC}
              alt={APP_NAME}
              width={140}
              height={52}
              className="object-contain"
            />
          </div>

          {isSuccess ? (
            <div className="text-center py-6">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-blue-100 mb-6">
                <Mail className="h-8 w-8 text-blue-600" />
              </div>
              <h2 className="text-2xl font-bold text-slate-950 mb-2">Confirme seu E-mail</h2>
              <p className="text-sm text-slate-600 mb-6">
                Cadastro criado. Enviamos um e-mail de confirmação para você. Confirme seu e-mail para continuar.
              </p>
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 mb-8 text-left">
                <p className="text-xs text-amber-800">
                  Após a confirmação do e-mail, seu acesso ficará aguardando liberação do administrador do {APP_NAME}.
                </p>
              </div>
              <Link
                href="/login"
                className="inline-block w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800"
              >
                Voltar para o Login
              </Link>
            </div>
          ) : (
            <>
              <div className="mb-8 text-center lg:text-left">
                <h2 className="text-3xl font-bold text-slate-950">Novo Cadastro</h2>
                <p className="mt-2 text-sm text-slate-500">
                  Preencha os dados abaixo para solicitar acesso.
                </p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-slate-700" htmlFor="name">
                    Nome Completo
                  </label>
                  <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-2.5 shadow-sm focus-within:border-blue-500 focus-within:ring-1 focus-within:ring-blue-500 transition-all">
                    <User className="h-4 w-4 text-slate-400" />
                    <input
                      id="name"
                      type="text"
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      className="w-full border-0 bg-transparent text-sm text-slate-900 outline-none"
                      placeholder="João da Silva"
                      required
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-slate-700" htmlFor="email">
                    E-mail
                  </label>
                  <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-2.5 shadow-sm focus-within:border-blue-500 focus-within:ring-1 focus-within:ring-blue-500 transition-all">
                    <Mail className="h-4 w-4 text-slate-400" />
                    <input
                      id="email"
                      type="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      className="w-full border-0 bg-transparent text-sm text-slate-900 outline-none"
                      placeholder="seu.email@empresa.com.br"
                      required
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-slate-700" htmlFor="password">
                    Senha
                  </label>
                  <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-2.5 shadow-sm focus-within:border-blue-500 focus-within:ring-1 focus-within:ring-blue-500 transition-all">
                    <LockKeyhole className="h-4 w-4 text-slate-400" />
                    <input
                      id="password"
                      type="password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      className="w-full border-0 bg-transparent text-sm text-slate-900 outline-none"
                      placeholder="Mínimo 6 caracteres"
                      required
                    />
                  </div>
                </div>
                
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-slate-700" htmlFor="confirmPassword">
                    Confirmar Senha
                  </label>
                  <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-2.5 shadow-sm focus-within:border-blue-500 focus-within:ring-1 focus-within:ring-blue-500 transition-all">
                    <LockKeyhole className="h-4 w-4 text-slate-400" />
                    <input
                      id="confirmPassword"
                      type="password"
                      value={confirmPassword}
                      onChange={(event) => setConfirmPassword(event.target.value)}
                      className="w-full border-0 bg-transparent text-sm text-slate-900 outline-none"
                      placeholder="Confirme sua senha"
                      required
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
                  className="mt-2 w-full rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-60"
                >
                  {isSubmitting ? "Cadastrando..." : "Criar Cadastro"}
                </button>
                
                <div className="text-center mt-6">
                  <Link href="/login" className="text-sm font-medium text-slate-600 hover:text-slate-900 transition">
                    Já tem uma conta? <span className="text-blue-600">Voltar ao login</span>
                  </Link>
                </div>
              </form>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
