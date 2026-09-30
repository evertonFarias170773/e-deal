"use client";

import { Suspense } from "react";
import { TarefasPage } from "@/features/tarefas/TarefasPage";

// useSearchParams (filtros na URL) exige Suspense no App Router.
export default function Page() {
  return (
    <Suspense fallback={null}>
      <TarefasPage />
    </Suspense>
  );
}
