"use client";

import React from "react";
import { useAuth } from "@/features/auth/AuthProvider";
import { hasPermissao } from "@/features/auth/usuarios.service";
import { UsuariosPerfisList } from "@/features/usuarios-perfis/components/UsuariosPerfisList";
import { AcessoNegado } from "@/features/usuarios-perfis/components/AcessoNegado";

export default function ConfigUsuariosPage() {
  const { user } = useAuth();

  if (!user) {
    return (
      <div className="flex h-96 items-center justify-center">
        <div className="flex flex-col items-center gap-2">
          <span className="h-8 w-8 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
          <p className="text-sm text-muted-foreground">
            Carregando informações da sessão...
          </p>
        </div>
      </div>
    );
  }

  // ⚠️ Regra de Acesso: Apenas is_super_adm, is_admin ou permissão específica
  const isAuthorized =
    user.isSuperAdmin ||
    user.isAdmin ||
    hasPermissao(user, "admin.usuarios.edit");

  if (!isAuthorized) {
    return (
      <div className="max-w-7xl mx-auto py-6 px-4">
        <AcessoNegado />
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6 py-6 px-4">
      {/* Cabeçalho da Seção */}
      <div className="border-b pb-5" style={{ borderColor: "var(--border)" }}>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          Configurações de Acesso
        </h1>
        <p className="text-sm mt-1 text-muted-foreground">
          Gestão centralizada de permissões e vinculação de perfis de operadores.
        </p>
      </div>

      {/* Componente Principal de Listagem e Gestão */}
      <UsuariosPerfisList />
    </div>
  );
}
