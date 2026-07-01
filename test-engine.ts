import { calcularStatusRecomendado } from "./src/features/orcamentos/services/status-engine.service";

const scenarios = [
  {
    name: "1. NOVO + arte em andamento",
    evidencias: {
      statusInternoAtual: "NOVO",
      pagamentosAtivos: [],
      modelos: [{ status_arte: "EM_ANDAMENTO", status_producao: "AGUARDANDO" }],
      isAvulso: false
    }
  },
  {
    name: "2. AGUARDANDO + arte em andamento",
    evidencias: {
      statusInternoAtual: "NOVO",
      pagamentosAtivos: [{ status: "A_RECEBER", confirmado: false }],
      modelos: [{ status_arte: "EM_CRIACAO", status_producao: "AGUARDANDO" }],
      isAvulso: false
    }
  },
  {
    name: "3. APROVADO + arte em andamento",
    evidencias: {
      statusInternoAtual: "NOVO",
      pagamentosAtivos: [{ status: "PAID", confirmado: true }],
      modelos: [{ status_arte: "EM_REVISAO_INTERNA", status_producao: "AGUARDANDO" }],
      isAvulso: false
    }
  },
  {
    name: "4. APROVADO + todas as artes aprovadas",
    evidencias: {
      statusInternoAtual: "NOVO",
      pagamentosAtivos: [{ status: "PAID", confirmado: true }],
      modelos: [{ status_arte: "APROVADA_CLIENTE", status_producao: "AGUARDANDO" }],
      isAvulso: false
    }
  }
];

console.log("Iniciando testes da Engine (Artes)...");
for (const s of scenarios) {
  const result = calcularStatusRecomendado(s.evidencias as any);
  console.log(`\nCenário: ${s.name}`);
  console.log(`Status Recomendado: ${result.statusRecomendado}`);
  console.log(`Mudaria Status? ${result.mudariaStatus}`);
  console.log(`Motivo: ${result.motivo}`);
}
