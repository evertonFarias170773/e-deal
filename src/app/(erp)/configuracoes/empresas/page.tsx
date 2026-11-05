"use client";

import { useAuth } from "@/features/auth/AuthProvider";
import { hasPermissao } from "@/features/auth/usuarios.service";
import { AcessoNegado } from "@/features/usuarios-perfis/components/AcessoNegado";
import { PercentualSimplesPage } from "@/features/configuracoes/PercentualSimplesPage";

/** Quem emite NFS-e (`fiscal.emit_nfse`) e administrador. O gate real é a rota /api/configuracoes/percentual-simples. */
export default function ConfigEmpresasPage() {
  const { user } = useAuth();

  if (!user) {
    return (
      <div className="flex h-96 items-center justify-center">
        <span className="h-8 w-8 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
      </div>
    );
  }

  if (!user.isAdmin && !user.isSuperAdmin && !hasPermissao(user, "fiscal.emit_nfse")) {
    return (
      <div className="max-w-7xl mx-auto py-6 px-4">
        <AcessoNegado />
      </div>
    );
  }

  return <PercentualSimplesPage />;
}
