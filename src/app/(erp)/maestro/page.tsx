import { MaestroPage } from "@/features/maestro/MaestroPage";

export const metadata = {
  title: "Maestro — Centro Inteligente | ERP Ideal",
  description: "Centro de inteligência do ERP Ideal — consultas, análises e assistência comercial",
};

/**
 * MaestroRoute — Server Component
 *
 * Lê MAESTRO_LLM_ENABLED do servidor (nunca NEXT_PUBLIC_) e injeta como prop.
 * Isso garante que a feature flag chegue ao client sem expor a chave da OpenAI.
 */
export default function MaestroRoute() {
  // process.env é lido APENAS no servidor. Nunca vaza para o bundle do browser.
  const llmEnabled = process.env.MAESTRO_LLM_ENABLED === 'true';

  return <MaestroPage llmEnabled={llmEnabled} />;
}
