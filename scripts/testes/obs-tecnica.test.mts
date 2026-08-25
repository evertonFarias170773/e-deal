/**
 * Orientacao tecnica de producao (`propostas.obs_tecnica`) — round-trip real.
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs scripts/testes/obs-tecnica.test.mts
 *
 * O QUE ESTE TESTE PROVA
 *   1. PURO — `serializePedidosObs` SEM `orientacoesDesign` no input nao quebra
 *      o parse dos outros cinco campos etiquetados de `propostas_os.obs`, e
 *      REPETE o bloco [Orientacoes para design] que ja estava gravado. Era a
 *      condicao de parada da rodada: parar de alimentar o blob nao podia
 *      derrubar nem apagar nada.
 *   2. BANCO — o caminho real do app, com o cliente Supabase de verdade:
 *      grava pela proposta, le como o boletim le, regrava pelo boletim, e
 *      reabre. O texto tem que sobreviver as duas releituras.
 *
 * O pedido usado e um ja marcado como encerrado de teste em producao. Nenhuma
 * outra coluna e tocada: so `obs_tecnica`, que nasceu vazia em 25/08/2026.
 */
import { readFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  parsePedidosObs,
  serializePedidosObs,
  atualizarObsTecnicaProposta
} from "../../src/features/pedidos/services/boletim-propostas.service.ts";
import { obterPedidoOperacionalPorIdOuIdInt } from "../../src/features/pedidos/services/pedidos-detalhe.service.ts";
import { montarOsPdfViewModel } from "../../src/features/pedidos/services/os-viewmodel.service.ts";

let falhas = 0;
function checar(nome: string, real: unknown, esperado: unknown) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) {
    falhas += 1;
    console.log(`FALHOU  ${nome}\n  esperado: ${JSON.stringify(esperado)}\n  real:     ${JSON.stringify(real)}`);
  } else {
    console.log(`ok      ${nome}`);
  }
}

// ── 1. PURO: parar de alimentar o blob preserva tudo ─────────────────────────
//
// Blob no formato real que `serializePedidosObs` produz, com os seis campos
// preenchidos — inclusive um [Orientacoes para design] com conteudo, que e
// justamente o que nao pode sumir.
const BLOB_EXISTENTE = [
  "[Observações críticas]",
  "Cliente exige conferência dupla.",
  "",
  "[Designer]",
  "user_id: abc-123",
  "nome: Fulano",
  "email: fulano@exemplo.com",
  "",
  "[Orientações para design]",
  "Texto antigo que precisa sobreviver.",
  "",
  "[Impressão]",
  "Bobinas de pulseiras de PINO sem pino.",
  "",
  "[Acabamento]",
  "Cortar em blocos de 50.",
  "",
  "[Logística]",
  "servico_transporte: SEDEX",
  "transportador: ",
  "peso_real: 1.93",
  "qtd_volumes: 2",
  "tipo_volume: caixa",
  "responsavel_logistica: Ciclano",
  "observacoes_frete: entregar pela manhã"
].join("\n");

// O boletim agora salva SEM `orientacoesDesign` — exatamente esta chamada.
const reserializado = serializePedidosObs(
  {
    obsCriticas: "Cliente exige conferência dupla.",
    obsImpressao: "Bobinas de pulseiras de PINO sem pino.",
    obsAcabamento: "Cortar em blocos de 50.",
    logistica: {
      servico_transporte: "SEDEX",
      transportador: "",
      peso_real: "1.93",
      qtd_volumes: "2",
      tipo_volume: "caixa",
      responsavel_logistica: "Ciclano",
      observacoes_frete: "entregar pela manhã"
    }
  },
  BLOB_EXISTENTE
);

const depois = parsePedidosObs(reserializado);

checar("[Orientacoes para design] PRESERVADO", depois.orientacoesDesign, "Texto antigo que precisa sobreviver.");
checar("[Observacoes criticas] intacto", depois.obsCriticas, "Cliente exige conferência dupla.");
checar("[Impressao] intacto", depois.obsImpressao, "Bobinas de pulseiras de PINO sem pino.");
checar("[Acabamento] intacto", depois.obsAcabamento, "Cortar em blocos de 50.");
checar("[Designer] intacto", depois.designer?.nome, "Fulano");
checar("[Logistica] intacta", depois.logistica?.observacoes_frete, "entregar pela manhã");

// E o caminho antigo, que passava string vazia, apagava mesmo? Registra o
// defeito que esta rodada elimina, para ninguem reintroduzir.
const comoEraAntes = parsePedidosObs(
  serializePedidosObs({ obsCriticas: "x", orientacoesDesign: "", obsImpressao: "y", obsAcabamento: "z" }, BLOB_EXISTENTE)
);
// O texto sumia e o serializador gravava o marcador "-" no lugar dele.
checar("caminho antigo apagava o bloco (regressao conhecida)", comoEraAntes.orientacoesDesign, "-");

// ── 2. BANCO: round-trip pelo caminho real do app ────────────────────────────
const ID_INT = 20370; // proposta ja marcada como encerrada de teste
const TEXTO_VENDEDOR = "TESTE 25/08: cortar em bobina de 100, sem pino. Conferir cor contra a amostra.";
const TEXTO_GERENTE = `${TEXTO_VENDEDOR}\nREVISADO PELO GERENTE: usar o gabarito novo e embalar em saco individual.`;

function clienteDeTeste(): SupabaseClient {
  // Le .env.local sem imprimir nada: a chave nunca vai para a saida.
  const env = readFileSync(".env.local", "utf8");
  const valor = (chave: string) => {
    const linha = env.split(/\r?\n/).find((l) => l.startsWith(`${chave}=`));
    return linha ? linha.slice(chave.length + 1).trim().replace(/^["']|["']$/g, "") : "";
  };
  const url = valor("NEXT_PUBLIC_SUPABASE_URL");
  const anon = valor("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  if (!url || !anon) throw new Error("NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY ausentes em .env.local");
  return createClient(url, anon);
}

const client = clienteDeTeste();

// (a) vendedor escreve na aba Producao — mesma coluna que saveProposta grava
const { error: erroVendedor } = await client
  .from("propostas")
  .update({ obs_tecnica: TEXTO_VENDEDOR })
  .eq("id_int", ID_INT);
checar("(a) proposta gravou sem erro", erroVendedor?.message ?? null, null);

// (b) o boletim abre e le — funcao real que a BoletimFormPage usa
const pedidoAposVendedor = await obterPedidoOperacionalPorIdOuIdInt(ID_INT, client);
checar("(b) boletim leu o texto do vendedor", pedidoAposVendedor?.obsTecnica, TEXTO_VENDEDOR);

// (c) gerente edita pelo Bloco 2 — funcao real que a BoletimFormPage chama
const gravacaoGerente = await atualizarObsTecnicaProposta(ID_INT, TEXTO_GERENTE, client);
checar("(c) boletim gravou sem erro", gravacaoGerente.success, true);

// (d) reabrir o boletim: o defeito de reidratacao era aqui
const pedidoReaberto = await obterPedidoOperacionalPorIdOuIdInt(ID_INT, client);
checar("(d) REABRIR mostra o texto salvo", pedidoReaberto?.obsTecnica, TEXTO_GERENTE);

// (e) o blob da OS nao foi tocado por nada disso
checar("(e) propostas_os.obs intacta no round-trip", pedidoReaberto?.obs, pedidoAposVendedor?.obs);

// (f) o texto chega ao view model dos DOIS PDFs — completo, sem truncar.
//     O componente e so JSX em volta deste campo; o que podia falhar era o
//     dado nao chegar ate aqui.
const pdf = await montarOsPdfViewModel(client, ID_INT, { incluirValores: false });
checar("(f) view model do PDF montou", pdf.success, true);
if (pdf.success) {
  checar("(f) vm.obsTecnica INTEIRA no PDF", pdf.vm.obsTecnica, TEXTO_GERENTE);
  checar("(f) sem truncamento em 200", pdf.vm.obsTecnica === TEXTO_GERENTE && pdf.vm.obsTecnica.length > 100, true);
}

console.log(falhas === 0 ? "\nTODOS OS TESTES PASSARAM" : `\n${falhas} FALHA(S)`);
process.exitCode = falhas === 0 ? 0 : 1;
