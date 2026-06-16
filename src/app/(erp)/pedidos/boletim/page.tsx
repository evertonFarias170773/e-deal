import React, { Suspense } from "react";
import { BoletimFormPage } from "@/features/pedidos";

export default function PedidosBoletimRoute() {
  return (
    <Suspense fallback={<div className="p-4 text-xs font-bold animate-pulse text-slate-500 font-sans">Carregando formulário de boletim...</div>}>
      <BoletimFormPage />
    </Suspense>
  );
}
