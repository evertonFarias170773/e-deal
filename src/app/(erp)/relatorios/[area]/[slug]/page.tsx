import { Suspense } from "react";
import { notFound } from "next/navigation";
import { PermissionGuard } from "@/components/common/PermissionGuard";
import { ReportPage } from "@/features/relatorios/ReportPage";
import { buscarRelatorio } from "@/features/relatorios/registro";

type RelatorioRouteProps = { params: Promise<{ area: string; slug: string }> };

export default async function RelatorioRoute({ params }: RelatorioRouteProps) {
  const { area, slug } = await params;
  const relatorio = buscarRelatorio(slug);
  if (!relatorio || relatorio.area !== area) notFound();

  return (
    <PermissionGuard permission={relatorio.permissao}>
      {/* A tela lê os filtros da URL (useSearchParams), que exige limite de Suspense. */}
      <Suspense fallback={null}>
        <ReportPage slug={relatorio.slug} />
      </Suspense>
    </PermissionGuard>
  );
}
