import { PedidoDetailPage } from "@/features/pedidos";

type PedidoDetailRouteProps = {
  params: Promise<{
    id: string;
  }>;
};

export default async function PedidoDetailRoute({ params }: PedidoDetailRouteProps) {
  const { id } = await params;
  const idInt = Number(id);

  return <PedidoDetailPage idInt={idInt} />;
}
