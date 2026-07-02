import { NotasFiscaisPage } from "@/features/fiscal/NotasFiscaisPage";
import { PermissionGuard } from "@/components/common/PermissionGuard";

export default function Page() {
  return (
    <PermissionGuard permission="fiscal.view">
      <NotasFiscaisPage />
    </PermissionGuard>
  );
}
