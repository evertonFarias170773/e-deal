"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { LockKeyhole, Mail } from "lucide-react";
import { useAuth } from "@/features/auth/AuthProvider";
import { getSupabaseClient } from "@/lib/supabase/client";
import { sanitizeInternalNext } from "@/features/auth/redirect-utils";

/** Destino pós-login sanitizado (?next=), lido no momento do clique (client-only). */
function obterDestinoPosLogin(): string {
  if (typeof window === "undefined") return "/dashboard";
  const params = new URLSearchParams(window.location.search);
  return sanitizeInternalNext(params.get("next"));
}

export function LoginForm() {
  const router = useRouter();
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      await login(email, password);
      router.replace(obterDestinoPosLogin());
    } catch (currentError) {
      setError(
        currentError instanceof Error
          ? currentError.message
          : "Nao foi possivel entrar. Tente novamente."
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleGoogleLogin() {
    setError(null);
    setIsGoogleLoading(true);
    
    try {
      const supabase = getSupabaseClient();
      if (!supabase) {
        throw new Error("Supabase client não está configurado.");
      }

      const origin = typeof window !== "undefined" ? window.location.origin : "";
      
      const next = obterDestinoPosLogin();
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}`,
        },
      });

      if (error) {
        throw error;
      }
    } catch (currentError) {
      setIsGoogleLoading(false);
      const message = currentError instanceof Error ? currentError.message : "Erro desconhecido";
      
      // Amigável para provider não configurado
      if (message.includes("provider is not enabled") || message.includes("not configured")) {
        setError("O login com Google ainda não está configurado no sistema. Por favor, use e-mail e senha.");
      } else {
        setError(`Não foi possível entrar com Google: ${message}`);
      }
    }
  }

  return (
    <div className="space-y-6">
      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="space-y-2">
          <label className="text-sm font-medium text-slate-700" htmlFor="email">
            E-mail
          </label>
          <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm focus-within:border-blue-500 focus-within:ring-1 focus-within:ring-blue-500 transition-all">
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

        <div className="space-y-2">
          <label className="text-sm font-medium text-slate-700" htmlFor="password">
            Senha
          </label>
          <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm focus-within:border-blue-500 focus-within:ring-1 focus-within:ring-blue-500 transition-all">
            <LockKeyhole className="h-4 w-4 text-slate-400" />
            <input
              id="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="w-full border-0 bg-transparent text-sm text-slate-900 outline-none"
              placeholder="Digite sua senha"
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
          disabled={isSubmitting || isGoogleLoading}
          className="w-full rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-60"
        >
          {isSubmitting ? "Entrando..." : "Entrar no ERP"}
        </button>
      </form>

      <div className="relative flex items-center py-2">
        <div className="flex-grow border-t border-slate-200"></div>
        <span className="flex-shrink-0 mx-4 text-xs font-medium text-slate-400 uppercase">Ou</span>
        <div className="flex-grow border-t border-slate-200"></div>
      </div>

      <button
        type="button"
        onClick={handleGoogleLogin}
        disabled={isSubmitting || isGoogleLoading}
        className="flex w-full items-center justify-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-60"
      >
        {isGoogleLoading ? (
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600" />
        ) : (
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
          </svg>
        )}
        Entrar com Google
      </button>

      <div className="flex flex-col items-center gap-3 pt-2 text-sm text-slate-600">
        <Link href="/esqueci-minha-senha" className="font-medium text-blue-600 hover:text-blue-500 transition">
          Esqueci minha senha
        </Link>
        <span className="text-slate-300">•</span>
        <Link href="/cadastro" className="font-medium text-blue-600 hover:text-blue-500 transition">
          Criar novo cadastro
        </Link>
      </div>
    </div>
  );
}
