import { CobrancasList } from "@/features/cobrancas";
import { PermissionGuard } from "@/components/common/PermissionGuard";

export default function CobrancasRoute() {
  return (
    <PermissionGuard permission="conferencia.view">
      <CobrancasList />
    </PermissionGuard>
  );
}
