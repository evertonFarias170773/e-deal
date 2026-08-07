import { Suspense } from "react";
import { MeuDesempenhoPage } from "@/features/meu-desempenho/MeuDesempenhoPage";

export default function Page() {
  return (
    <Suspense>
      <MeuDesempenhoPage />
    </Suspense>
  );
}
