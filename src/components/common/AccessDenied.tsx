import { AlertCircle } from "lucide-react";
import { EmptyState } from "@/components/common/EmptyState";

interface AccessDeniedProps {
  message?: string;
}

export function AccessDenied({ message = "Você não tem permissão para visualizar esta página." }: AccessDeniedProps) {
  return (
    <div className="p-6">
      <EmptyState
        title="Acesso Negado"
        description={message}
        icon={AlertCircle}
      />
    </div>
  );
}
