/**
 * Pre-postagem dos Correios com a NF-e do pedido (03/11/2026).
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/prepostagem-nfe.test.mts
 *
 * Nao chama a API dos Correios: so monta o payload (`montarPayloadPrepostagem`).
 * Qualquer fetch para *.correios.com.br falha o teste. O banco e lido so com GET.
 *
 * 1. Sem NF-e, o payload e IDENTICO ao de antes (a referencia abaixo e o corpo
 *    copiado de criarPrepostagem antes de 03/11/2026).
 * 2. Com NF-e autorizada, vao chaveNFe (44 digitos), numeroNotaFiscal e os itens.
 * 3. A escolha da nota segue escolherNotaAutorizadaDoPedido e a chave perde o "NFe".
 * 4. Pedidos reais: um com NF-e autorizada e um sem.
 */
import { config as carregarEnv } from "dotenv";
import { contatoParaPayload, montarPayloadPrepostagem, type CwsPrepostagemInput } from "@/lib/correios/cws";
import { chaveNfeParaCorreios, notaParaPrepostagem, COLUNAS_NOTA_DA_PREPOSTAGEM } from "@/lib/correios/nota-da-prepostagem";

carregarEnv({ path: ".env.local", quiet: true });

const fetchOriginal = globalThis.fetch;
globalThis.fetch = (async (alvo: string | URL | Request, init?: RequestInit) => {
  const url = String(alvo instanceof Request ? alvo.url : alvo);
  if (/correios\.com\.br/i.test(url)) throw new Error("TESTE CHAMOU A API DOS CORREIOS: " + url);
  if ((init?.method ?? "GET").toUpperCase() !== "GET") throw new Error("TESTE TENTOU ESCREVER: " + url);
  return fetchOriginal(alvo, init);
}) as typeof fetch;

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

/** O corpo como criarPrepostagem montava ate 03/11/2026 (copia literal). */
function payloadDeAntes(input: CwsPrepostagemInput, cfg: { servicoSedex: string; servicoPac: string; cartaoPostagem: string; contrato: string }) {
  return {
    codigoServico: input.servico === "SEDEX" ? cfg.servicoSedex : cfg.servicoPac,
    remetente: {
      nome: input.remetente.nome,
      cpfCnpj: input.remetente.cnpj.replace(/\D/g, ""),
      ...contatoParaPayload(input.remetente.telefone),
      endereco: {
        cep: input.remetente.cep.replace(/\D/g, ""),
        logradouro: input.remetente.logradouro,
        numero: input.remetente.numero || "S/N",
        complemento: input.remetente.complemento,
        bairro: input.remetente.bairro,
        cidade: input.remetente.cidade,
        uf: input.remetente.uf
      }
    },
    destinatario: {
      nome: input.destinatario.nome,
      ...contatoParaPayload(input.destinatario.telefone),
      endereco: {
        cep: input.destinatario.cep.replace(/\D/g, ""),
        logradouro: input.destinatario.logradouro,
        numero: input.destinatario.numero || "S/N",
        complemento: input.destinatario.complemento,
        bairro: input.destinatario.bairro,
        cidade: input.destinatario.cidade,
        uf: input.destinatario.uf
      }
    },
    numeroCartaoPostagem: cfg.cartaoPostagem,
    ...(cfg.contrato ? { numeroContrato: cfg.contrato } : {}),
    codigoFormatoObjetoInformado: "2",
    pesoInformado: String(Math.max(1, Math.round(input.pesoGramas))),
    alturaInformada: String(Math.max(1, Math.round(input.alturaCm))),
    larguraInformada: String(Math.max(1, Math.round(input.larguraCm))),
    cienteObjetoNaoProibido: "1",
    solicitarColeta: "N",
    comprimentoInformado: String(Math.max(1, Math.round(input.comprimentoCm))),
    itensDeclaracaoConteudo: input.itensDeclaracao?.length
      ? input.itensDeclaracao
      : [{ conteudo: "Material grafico", quantidade: "1", valor: "0.00" }]
  };
}

const CFG = { servicoSedex: "03220", servicoPac: "03298", cartaoPostagem: "0000000000", contrato: "9999999999" };
const BASE: CwsPrepostagemInput = {
  servico: "SEDEX",
  idEmpresa: 1,
  pesoGramas: 950.4,
  alturaCm: 10,
  larguraCm: 20,
  comprimentoCm: 25,
  remetente: { nome: "Remetente", cnpj: "14.152.597/0001-02", cep: "90000-000", logradouro: "Rua A", numero: "1", complemento: "", bairro: "B", cidade: "Porto Alegre", uf: "RS", telefone: "(51) 99999-0000" },
  destinatario: { nome: "Cliente", cep: "97700-065", logradouro: "Rua C", numero: "", complemento: "ap 2", bairro: "D", cidade: "Santiago", uf: "RS", telefone: "5532510000" },
  itensDeclaracao: [{ conteudo: "Cartao de visita", quantidade: "1000", valor: "0.20" }]
};
const CHAVE = "43261114152597000102550020000484521856779782";

// ── 1. SEM NF-E: IDENTICO ──────────────────────────────────────────────────
checar("sem nota (campo ausente): igual ao de antes", montarPayloadPrepostagem(BASE, CFG), payloadDeAntes(BASE, CFG));
checar("sem nota (null): igual ao de antes", montarPayloadPrepostagem({ ...BASE, notaFiscal: null }, CFG), payloadDeAntes(BASE, CFG));
const semItens = { ...BASE, itensDeclaracao: [] };
checar("sem nota e sem itens: generico, igual ao de antes", montarPayloadPrepostagem(semItens, CFG), payloadDeAntes(semItens, CFG));
const semContrato = { ...CFG, contrato: "" };
checar("sem nota e sem contrato: igual ao de antes", montarPayloadPrepostagem({ ...BASE, servico: "PAC" }, semContrato), payloadDeAntes({ ...BASE, servico: "PAC" }, semContrato));
checar("sem nota: nenhum campo de NF", Object.keys(montarPayloadPrepostagem(BASE, CFG)).filter((k) => /chave|nfe|notafiscal/i.test(k)), []);

// ── 2. COM NF-E ─────────────────────────────────────────────────────────────
const comNota = montarPayloadPrepostagem({ ...BASE, notaFiscal: { chave: CHAVE, numero: "48452" } }, CFG);
checar("com nota: chaveNFe de 44 digitos", [comNota.chaveNFe, /^\d{44}$/.test(String(comNota.chaveNFe))], [CHAVE, true]);
checar("com nota: numeroNotaFiscal", comNota.numeroNotaFiscal, "48452");
checar("com nota: itens da declaracao continuam", comNota.itensDeclaracaoConteudo, BASE.itensDeclaracao);
const { chaveNFe: _c, numeroNotaFiscal: _n, ...resto } = comNota;
checar("com nota: o resto e o payload de antes", resto, payloadDeAntes(BASE, CFG));

// ── 3. ESCOLHA DA NOTA E FORMATO DA CHAVE ───────────────────────────────────
checar("chave: tira o prefixo NFe", chaveNfeParaCorreios("NFe" + CHAVE), CHAVE);
checar("chave: 44 digitos sem prefixo passa", chaveNfeParaCorreios(CHAVE), CHAVE);
checar("chave: 43 digitos recusa", chaveNfeParaCorreios("NFe" + CHAVE.slice(1)), null);
checar("chave: vazia recusa", chaveNfeParaCorreios(null), null);
const n = (o: Record<string, unknown>) => ({ status: "AUTORIZADA", numero_nf: "48452", ambiente: "producao", data_autorizacao: "2026-11-03T12:53:02Z", created_at: "2026-11-03T12:50:00Z", tipo_nota: null, chave_nfe: "NFe" + CHAVE, ...o });
checar("nota autorizada de producao vai", notaParaPrepostagem([n({})]), { chave: CHAVE, numero: "48452" });
checar("homologacao nao vai", notaParaPrepostagem([n({ ambiente: "homologacao" })]), null);
checar("cancelada nao vai", notaParaPrepostagem([n({ status: "CANCELADA" })]), null);
checar("processando nao vai", notaParaPrepostagem([n({ status: "PROCESSANDO" })]), null);
checar("remessa nao vai", notaParaPrepostagem([n({ tipo_nota: "REMESSA" })]), null);
checar("autorizada com chave ruim nao vai", notaParaPrepostagem([n({ chave_nfe: "NFe123" })]), null);
checar(
  "duas autorizadas: a mais recente",
  notaParaPrepostagem([n({ numero_nf: "100", data_autorizacao: "2026-10-01T10:00:00Z", chave_nfe: "NFe" + "1".repeat(44) }), n({})]),
  { chave: CHAVE, numero: "48452" }
);
checar("sem notas", notaParaPrepostagem([]), null);

// ── 4. PEDIDOS REAIS (so leitura) ───────────────────────────────────────────
const U = process.env.NEXT_PUBLIC_SUPABASE_URL;
const K = process.env.SUPABASE_SERVICE_ROLE_KEY;
async function notasDe(idInt: number) {
  const r = await fetch(`${U}/rest/v1/notas_fiscais?select=${encodeURIComponent(COLUNAS_NOTA_DA_PREPOSTAGEM.replace(/\s/g, ""))}&id_int=eq.${idInt}`, {
    headers: { apikey: String(K), Authorization: `Bearer ${K}` }
  });
  if (!r.ok) throw new Error(`notas_fiscais ${r.status}`);
  return r.json();
}
if (U && K) {
  const real = notaParaPrepostagem(await notasDe(24372));
  checar("24372 (NF-e autorizada): chave de 44 e numero", [Boolean(real), /^\d{44}$/.test(real?.chave ?? ""), Boolean(real?.numero)], [true, true, true]);
  const payloadReal = montarPayloadPrepostagem({ ...BASE, notaFiscal: real }, CFG);
  console.log(
    "        exemplo 24372:",
    JSON.stringify({
      chaveNFe: String(payloadReal.chaveNFe).slice(0, 8) + "…" + String(payloadReal.chaveNFe).slice(-4),
      numeroNotaFiscal: payloadReal.numeroNotaFiscal,
      itensDeclaracaoConteudo: payloadReal.itensDeclaracaoConteudo
    })
  );
  const semNotaReal = notaParaPrepostagem(await notasDe(24261));
  checar("24261 (sem NF-e): payload igual ao de antes", montarPayloadPrepostagem({ ...BASE, notaFiscal: semNotaReal }, CFG), payloadDeAntes(BASE, CFG));
} else {
  console.log("(sem credencial do banco: pedidos reais pulados)");
}

console.log(falhas === 0 ? "\ntudo certo" : `\n${falhas} falha(s)`);
process.exitCode = falhas === 0 ? 0 : 1;
