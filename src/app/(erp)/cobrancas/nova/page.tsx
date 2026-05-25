import { CriarCobrancaForm } from "@/features/cobrancas/CriarCobrancaForm";

type NovaCobrancaRouteProps = {
  searchParams: Promise<{
    id_int?: string;
  }>;
};

export default async function NovaCobrancaRoute({ searchParams }: NovaCobrancaRouteProps) {
  const params = await searchParams;
  const propostaIdInt = params.id_int ? Number(params.id_int) : undefined;

  return <CriarCobrancaForm propostaIdInt={Number.isNaN(propostaIdInt) ? undefined : propostaIdInt} />;
}
