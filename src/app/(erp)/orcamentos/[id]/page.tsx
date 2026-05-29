import { OrcamentoDetailPage } from "@/features/orcamentos/OrcamentoDetailPage";

type OrcamentoDetailRouteProps = {
  params: Promise<{
    id: string;
  }>;
};

export default async function OrcamentoDetailRoute({ params }: OrcamentoDetailRouteProps) {
  const { id } = await params;
  const idInt = Number(id);

  return <OrcamentoDetailPage idInt={idInt} />;
}

