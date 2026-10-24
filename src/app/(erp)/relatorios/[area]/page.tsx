import { notFound } from "next/navigation";
import { AreaRelatoriosPage } from "@/features/relatorios/AreaRelatoriosPage";
import { areasComRelatorio } from "@/features/relatorios/registro";

type AreaRouteProps = { params: Promise<{ area: string }> };

export default async function RelatoriosAreaRoute({ params }: AreaRouteProps) {
  const { area } = await params;
  const dados = areasComRelatorio().find((a) => a.id === area);
  if (!dados) notFound();
  // Sem PermissionGuard de propósito: a página lista só os relatórios que o
  // usuário pode abrir, e cada relatório tem o seu guard e a sua checagem no servidor.
  return <AreaRelatoriosPage area={dados.id} />;
}
