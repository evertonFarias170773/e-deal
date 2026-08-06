import { VerificacaoPage } from "@/features/verificacao/VerificacaoPage";
import type { Metadata } from "next";
import { APP_NAME } from "@/constants/brand";

export const metadata: Metadata = {
  title: `Verificação de Documento | ${APP_NAME}`,
  description: "Painel de consulta cadastral e verificação de CPF/CNPJ."
};

export default function VerificacaoRoute() {
  return <VerificacaoPage />;
}
