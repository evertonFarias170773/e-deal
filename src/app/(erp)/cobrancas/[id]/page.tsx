import { CobrancaDetail } from "@/features/cobrancas/CobrancaDetail";

type CobrancaDetailRouteProps = {
  params: Promise<{
    id: string;
  }>;
};

export default async function CobrancaDetailRoute({ params }: CobrancaDetailRouteProps) {
  const { id } = await params;

  return <CobrancaDetail cobrancaId={id} />;
}
