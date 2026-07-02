import { ContasReceberPage } from "@/features/contas-a-receber";
import { PermissionGuard } from "@/components/common/PermissionGuard";

export default function ContasAReceberRoute() {
  return (
    <PermissionGuard permission="contas_receber.view">
      <ContasReceberPage />
    </PermissionGuard>
  );
}
