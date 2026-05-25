import { PublicCobrancaPage } from "@/features/cobrancas/PublicCobrancaPage";

type PagamentoPublicoRouteProps = {
  params: Promise<{
    token: string;
  }>;
};

export default async function PagamentoPublicoRoute({ params }: PagamentoPublicoRouteProps) {
  const { token } = await params;

  return <PublicCobrancaPage token={token} />;
}
