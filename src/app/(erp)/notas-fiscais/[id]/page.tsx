import { NfeDetailPage } from "@/features/nfe/components/NfeDetailPage";
import { PermissionGuard } from "@/components/common/PermissionGuard";

type NfeDetailRouteProps = {
  params: Promise<{
    id: string;
  }>;
};

export default async function Page({ params }: NfeDetailRouteProps) {
  const { id } = await params;
  return (
    <PermissionGuard permission="fiscal.view">
      <NfeDetailPage noteId={id} />
    </PermissionGuard>
  );
}
