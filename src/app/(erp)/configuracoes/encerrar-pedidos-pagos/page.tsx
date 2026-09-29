"use client";

import { useAuth } from "@/features/auth/AuthProvider";
import { AcessoNegado } from "@/features/usuarios-perfis/components/AcessoNegado";
import { EncerrarPedidosPagosPage } from "@/features/encerramento-transicao/EncerrarPedidosPagosPage";

/** Só administrador. O gate real é a rota /api/admin/encerrar-pedidos-pagos (403 para os demais). */
export default function ConfigEncerrarPedidosPagosPage() {
  const { user } = useAuth();

  if (!user) {
    return (
      <div className="flex h-96 items-center justify-center">
        <span className="h-8 w-8 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
      </div>
    );
  }

  if (!user.isAdmin && !user.isSuperAdmin) {
    return (
      <div className="max-w-7xl mx-auto py-6 px-4">
        <AcessoNegado />
      </div>
    );
  }

  return <EncerrarPedidosPagosPage />;
}
