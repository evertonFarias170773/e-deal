import { RegistroRecebiveisPage } from "@/features/contas-a-receber/registro-recebiveis/RegistroRecebiveisPage";
import { PermissionGuard } from "@/components/common/PermissionGuard";

export default function RegistroRecebiveisRoute() {
  return (
    <PermissionGuard permission="contas_receber.view">
      <RegistroRecebiveisPage />
    </PermissionGuard>
  );
}
