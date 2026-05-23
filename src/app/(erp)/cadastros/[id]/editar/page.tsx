import { notFound } from "next/navigation";
import { CadastroFormPage } from "@/features/cadastros/CadastroFormPage";
import { getCadastroDetailReadOnly } from "@/features/cadastros/services/cadastros.service";

type EditarCadastroRouteProps = {
  params: Promise<{
    id: string;
  }>;
};

export default async function EditarCadastroRoute({ params }: EditarCadastroRouteProps) {
  const { id } = await params;
  const { cadastro } = await getCadastroDetailReadOnly(id);

  if (!cadastro) {
    notFound();
  }

  return <CadastroFormPage mode="edit" cadastro={cadastro} />;
}
