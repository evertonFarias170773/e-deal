"use client";

import { useAuth } from "@/features/auth/AuthProvider";
import { hasPermissao } from "@/features/auth/usuarios.service";
import { AcessoNegado } from "@/features/usuarios-perfis/components/AcessoNegado";
import { IntegracaoLisitonConfigPage } from "@/features/integracoes/lisiton/IntegracaoLisitonConfigPage";

/** ADM ou "Configurar Integrações". O gate real é a função do banco lisiton_config_definir_empresa. */
export default function ConfigIntegracaoLisitonPage() {
  const { user } = useAuth();

  if (!user) {
    return (
      <div className="flex h-96 items-center justify-center">
        <span className="h-8 w-8 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
      </div>
    );
  }

  if (!user.isAdmin && !user.isSuperAdmin && !hasPermissao(user, "config.integracoes")) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-6">
        <AcessoNegado />
      </div>
    );
  }

  return <IntegracaoLisitonConfigPage />;
}
