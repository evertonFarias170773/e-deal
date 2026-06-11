import React from "react";
import Link from "next/link";
import { ShieldAlert } from "lucide-react";

export function AcessoNegado() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center p-6 text-center">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-amber-50 dark:bg-amber-950/30">
        <ShieldAlert className="h-10 w-10 text-amber-600 dark:text-amber-500" />
      </div>
      <h1 className="mb-2 text-2xl font-bold tracking-tight text-foreground">
        Acesso Restrito
      </h1>
      <p className="mb-6 max-w-md text-sm text-muted-foreground">
        Esta área é de uso exclusivo de administradores do ERP. Seu perfil atual não possui privilégios de acesso para gerenciar contas ou vincular perfis de segurança.
      </p>
      <Link
        href="/dashboard"
        className="inline-flex items-center justify-center rounded-xl px-4 py-2.5 text-sm font-semibold transition"
        style={{
          background: "var(--primary)",
          color: "var(--primary-foreground)"
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLAnchorElement).style.opacity = "0.9";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLAnchorElement).style.opacity = "1";
        }}
      >
        Voltar para o Dashboard
      </Link>
    </div>
  );
}
