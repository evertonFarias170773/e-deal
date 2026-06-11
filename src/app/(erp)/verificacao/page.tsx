import { VerificacaoPage } from "@/features/verificacao/VerificacaoPage";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Verificação de Documento | ERP Ideal",
  description: "Painel de consulta cadastral e verificação de CPF/CNPJ."
};

export default function VerificacaoRoute() {
  return <VerificacaoPage />;
}
