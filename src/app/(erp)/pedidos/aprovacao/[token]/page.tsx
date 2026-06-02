import { ClienteAprovacaoPage } from "@/features/pedidos";

type AprovacaoPublicaRouteProps = {
  params: Promise<{
    token: string;
  }>;
};

export default async function AprovacaoPublicaRoute({ params }: AprovacaoPublicaRouteProps) {
  const { token } = await params;

  return <ClienteAprovacaoPage token={token} />;
}
