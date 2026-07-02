"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { LoadingSkeleton } from "@/components/common/LoadingSkeleton";
import { useAuth } from "@/features/auth/AuthProvider";
import { LogOut, ShieldAlert, Clock } from "lucide-react";

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { user, isAuthenticated, isLoading, isBlocked, logout } = useAuth();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.replace("/login");
    }
  }, [isAuthenticated, isLoading, router]);

  if (isLoading || !isAuthenticated) {
    return (
      <div className="min-h-screen bg-slate-50 p-6">
        <LoadingSkeleton variant="page" />
      </div>
    );
  }

  const isPending = user?.perfilSlug === "pendente_aprovacao";

  if (isBlocked || isPending) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
        <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-xl shadow-slate-900/5">
          <div className={`mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full ${isPending ? 'bg-amber-100 text-amber-600' : 'bg-red-100 text-red-600'}`}>
            {isPending ? <Clock className="h-8 w-8" /> : <ShieldAlert className="h-8 w-8" />}
          </div>
          <h2 className="mb-2 text-2xl font-bold text-slate-900">
            {isPending ? "Acesso Pendente" : "Acesso não configurado"}
          </h2>
          <p className="mb-8 text-sm leading-relaxed text-slate-600">
            {isPending 
              ? "Sua conta foi autenticada, mas o seu acesso ainda está pendente. Aguarde a aprovação do administrador do ERP Ideal." 
              : "Sua conta foi autenticada, mas ainda não possui cadastro ativo ou perfil de acesso configurado no ERP Ideal. Entre em contato com o administrador do sistema."}
          </p>
          <button
            onClick={async () => {
              await logout();
              router.replace("/login");
            }}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800"
          >
            <LogOut className="h-4 w-4" />
            Sair e voltar ao login
          </button>
        </div>
      </div>
    );
  }

  return children;
}

