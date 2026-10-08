/**
 * Aviso de nota de remessa — src/features/fiscal/lib/aviso-remessa.ts (08/10/2026).
 *
 *   node --experimental-strip-types scripts/testes/aviso-remessa.test.mts
 *
 * O QUE PROVA
 *   1. Cidade diferente e UF diferente: alerta FORTE, com o texto combinado.
 *   2. Mesmo município com CEP, número ou rua diferentes: aviso LEVE.
 *   3. Igual não avisa — inclusive com "Av." contra "Avenida", acento, caixa,
 *      CEP com ou sem traço, e bairro ou complemento diferentes.
 *   4. Retirada no balcão, endereço ausente ou incompleto e pedido que já tem
 *      remessa não avisam.
 *   5. A montagem por pedido: pagador, despacho confirmado, principal, remessa.
 *   6. Leitura que falhou (não pronta): nenhum selo, sem erro.
 */
import {
  ACAO_DA_REMESSA,
  avaliarRemessa,
  avisoDeRemessaDaLinha,
  avisosDeRemessaPorPedido,
  chaveDoLogradouro,
  chaveDoMunicipio,
  dicaDoAvisoDeRemessa,
  enderecoComparavel,
  resumoDoEndereco,
  soDigitos,
  type DadosParaAvisosDeRemessa,
  type EnderecoParaRemessa
} from "../../src/features/fiscal/lib/aviso-remessa.ts";

let falhas = 0;
function checar(nome: string, obtido: unknown, esperado: unknown) {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas += 1;
  console.log(`${ok ? "ok  " : "FALHOU"} ${nome}${ok ? "" : `\n       obtido:   ${JSON.stringify(obtido)}\n       esperado: ${JSON.stringify(esperado)}`}`);
}

// Endereços FICTÍCIOS.
const nfe: EnderecoParaRemessa = { logradouro: "Avenida Ipiranga", numero: "1000", cidade: "Porto Alegre", uf: "RS", cep: "90160-093" };
const com = (mudanca: Partial<EnderecoParaRemessa>): EnderecoParaRemessa => ({ ...nfe, ...mudanca });
const nivel = (entrega: EnderecoParaRemessa | null, modalidadeFrete: string | null = "CIF") => avaliarRemessa({ modalidadeFrete, entrega, nfe }).nivel;

// ── normalização ────────────────────────────────────────────────────────────
checar("municipio: mesma chave do banco", ["Sant'Ana do Livramento", "SANTANA DO LIVRAMENTO", "São Paulo", "sao paulo", "Ji-Paraná"].map(chaveDoMunicipio), ["santanadolivramento", "santanadolivramento", "saopaulo", "saopaulo", "jiparana"]);
checar("logradouro: abreviacoes do tipo", ["Av. Ipiranga", "AVENIDA IPIRANGA", "Avda Ipiranga", "R. dos Andradas", "Rua dos Andradas", "Trav. do Carmo", "Travessa do Carmo", "Rod. BR-116", "Pça. da Matriz"].map(chaveDoLogradouro),
  ["avenidaipiranga", "avenidaipiranga", "avenidaipiranga", "ruadosandradas", "ruadosandradas", "travessadocarmo", "travessadocarmo", "rodoviabr116", "pracadamatriz"]);
checar("logradouro: so a PRIMEIRA palavra e tipo ('Rua R' nao vira 'Rua Rua')", chaveDoLogradouro("Rua R"), "ruar");
checar("digitos", [soDigitos("90160-093"), soDigitos(" 90.160 093 "), soDigitos(null)], ["90160093", "90160093", ""]);

// ── 1. FORTE ────────────────────────────────────────────────────────────────
const outraCidade = avaliarRemessa({ modalidadeFrete: "CIF", entrega: com({ cidade: "Canoas", cep: "92010-000", logradouro: "Rua A", numero: "5" }), nfe });
checar("cidade diferente: forte", [outraCidade.nivel, outraCidade.titulo], ["FORTE", "Nota de remessa necessária"]);
checar("cidade diferente: o texto combinado", outraCidade.texto, "Entrega em Canoas/RS, diferente do endereço da NF-e (Porto Alegre/RS)");
checar("UF diferente com cidade de mesmo nome: forte", nivel(com({ uf: "SC" })), "FORTE");
checar("UF diferente: o texto", avaliarRemessa({ entrega: com({ cidade: "Florianópolis", uf: "sc", cep: "88010-000" }), nfe }).texto, "Entrega em Florianópolis/SC, diferente do endereço da NF-e (Porto Alegre/RS)");
checar("modalidade nula tambem avisa (so RETIRA dispensa)", nivel(com({ cidade: "Canoas" }), null), "FORTE");
checar("FOB avisa", nivel(com({ cidade: "Canoas" }), "FOB"), "FORTE");

// ── 2. LEVE ─────────────────────────────────────────────────────────────────
const outroCep = avaliarRemessa({ modalidadeFrete: "CIF", entrega: com({ cep: "90010-150" }), nfe });
checar("mesmo municipio, CEP diferente: leve", [outroCep.nivel, outroCep.texto], ["LEVE", "Entrega em endereço diferente do faturamento: confira se precisa de nota de remessa"]);
checar("mesmo municipio, numero diferente: leve", nivel(com({ numero: "1200" })), "LEVE");
checar("mesmo municipio, rua diferente: leve", nivel(com({ logradouro: "Rua dos Andradas" })), "LEVE");

// ── 3. IGUAL ────────────────────────────────────────────────────────────────
checar("identico: nada", nivel(com({})), "NENHUM");
checar("'Av.' contra 'Avenida': nada", nivel(com({ logradouro: "Av. Ipiranga" })), "NENHUM");
checar("acento, caixa e espacos: nada", nivel({ logradouro: "  AVENIDA  IPIRANGA ", numero: "1000", cidade: "PORTO ALEGRE", uf: "rs", cep: "90160093" }), "NENHUM");
checar("numero com letras em volta: so os digitos contam", nivel(com({ numero: "nº 1000" })), "NENHUM");
checar("bairro e complemento nao entram: nada", avaliarRemessa({ entrega: { ...nfe, ...({ bairro: "Outro", complemento: "Sala 9" } as object) }, nfe }).nivel, "NENHUM");
checar("sem aviso: titulo, texto e dica vazios", [avaliarRemessa({ entrega: nfe, nfe }).titulo, dicaDoAvisoDeRemessa(avaliarRemessa({ entrega: nfe, nfe }))], ["", ""]);

// ── 4. NÃO SE APLICA ────────────────────────────────────────────────────────
checar("retira no balcao: nada, mesmo com outra cidade", [nivel(com({ cidade: "Canoas" }), "RETIRA"), nivel(com({ cidade: "Canoas" }), " retira ")], ["NENHUM", "NENHUM"]);
checar("sem endereco de entrega: nada", nivel(null), "NENHUM");
checar("endereco incompleto some",
  [com({ cep: "" }), com({ cep: "9016" }), com({ cidade: "" }), com({ uf: "" }), com({ uf: "RSX" }), com({ logradouro: "" }), com({ logradouro: "NULL" }), com({ cidade: "[object Object]" })].map((e) => [enderecoComparavel(e), nivel({ ...e, numero: "9" })]),
  Array.from({ length: 8 }, () => [false, "NENHUM"]));
checar("endereco da NF-e incompleto tambem some", avaliarRemessa({ entrega: com({ cidade: "Canoas" }), nfe: com({ cep: null }) }).nivel, "NENHUM");
checar("'S/N' contra 1000: leve", nivel({ ...nfe, numero: "S/N" }), "LEVE");
checar("'S/N' contra vazio: igual", avaliarRemessa({ entrega: { ...nfe, numero: "S/N" }, nfe: { ...nfe, numero: "" } }).nivel, "NENHUM");
checar("pedido que ja tem remessa: nada", avaliarRemessa({ entrega: com({ cidade: "Canoas" }), nfe, jaTemRemessa: true }).nivel, "NENHUM");

// ── textos ──────────────────────────────────────────────────────────────────
checar("resumo: rua, cidade/UF e CEP, sem nome nem documento", resumoDoEndereco(nfe), "Avenida Ipiranga, 1000 — Porto Alegre/RS — CEP 90160-093");
checar("a dica traz a frase, os dois enderecos e a acao",
  dicaDoAvisoDeRemessa(outroCep).split("\n"),
  ["Entrega em endereço diferente do faturamento: confira se precisa de nota de remessa.", "Entrega: Avenida Ipiranga, 1000 — Porto Alegre/RS — CEP 90010-150", "NF-e: Avenida Ipiranga, 1000 — Porto Alegre/RS — CEP 90160-093", ACAO_DA_REMESSA]);
checar("a acao aponta para o que existe", ACAO_DA_REMESSA.includes("Gerar nota de remessa"), true);

// ── 5. por pedido ───────────────────────────────────────────────────────────
const end = (id: string, id_cliente: number, tipo: string, cidade: string, extra: Partial<DadosParaAvisosDeRemessa["enderecos"][number]> = {}) =>
  ({ id, id_cliente, tipo_endereco: tipo, endereco: "Avenida Ipiranga", numero: "1000", cidade, uf: "RS", cep: "90160093", data_criacao: "2026-01-01T00:00:00Z", ...extra });
const dados: DadosParaAvisosDeRemessa = {
  propostas: [
    { id_int: 1, id_cliente: 10, id_faturado: null, id_endereco_ent: "e-canoas", modalidade_frete: "CIF" }, // entrega em outra cidade
    { id_int: 2, id_cliente: 10, id_faturado: null, id_endereco_ent: "p-10", modalidade_frete: "CIF" }, // entrega no principal
    { id_int: 3, id_cliente: 10, id_faturado: null, id_endereco_ent: "e-canoas", modalidade_frete: "RETIRA" }, // retira
    { id_int: 4, id_cliente: 10, id_faturado: 20, id_endereco_ent: "p-10", modalidade_frete: "CIF" }, // pagador de outra cidade
    { id_int: 5, id_cliente: 10, id_faturado: null, id_endereco_ent: "e-canoas", modalidade_frete: "CIF" }, // ja tem remessa
    { id_int: 6, id_cliente: 10, id_faturado: null, id_endereco_ent: "p-10", modalidade_frete: "CIF" }, // despacho confirmado em outro lugar
    { id_int: 7, id_cliente: 10, id_faturado: null, id_endereco_ent: null, modalidade_frete: "CIF" }, // sem endereco
    { id_int: 8, id_cliente: 30, id_faturado: null, id_endereco_ent: "e-canoas", modalidade_frete: "CIF" }, // cliente sem principal
    { id_int: 9, id_cliente: 10, id_faturado: 10, id_endereco_ent: "e-mesma-cidade", modalidade_frete: "FOB" }, // mesma cidade, outro CEP
    { id_int: 10, id_cliente: 10, id_faturado: null, id_endereco_ent: "e-canoas", modalidade_frete: "CIF" } // remessa cancelada nao conta
  ],
  expedicoes: [
    { id_int: 6, id_endereco_entrega: "e-canoas", data_despacho: "2026-10-01T12:00:00Z" },
    { id_int: 2, id_endereco_entrega: "e-canoas", data_despacho: null } // rascunho de despacho nao vale
  ],
  enderecos: [
    end("p-10", 10, "PRINCIPAL", "Porto Alegre"),
    end("p-10-velho", 10, "principal", "Gravataí", { data_criacao: "2027-01-01T00:00:00Z" }),
    end("e-canoas", 10, "ENTREGA", "Canoas", { cep: "92010000" }),
    end("e-mesma-cidade", 10, "ENTREGA", "Porto Alegre", { cep: "90010150" }),
    end("p-20", 20, "PRINCIPAL", "Caxias do Sul", { cep: "95010000" })
  ],
  remessas: [
    { id_int: 5, status: "AUTORIZADA" },
    { id_int: 10, status: "CANCELADA" }
  ]
};
const porPedido = avisosDeRemessaPorPedido(dados);
checar("por pedido: quem recebe aviso e de que nivel",
  [...porPedido].sort((a, b) => a[0] - b[0]).map(([id, a]) => [id, a.nivel]),
  [[1, "FORTE"], [4, "FORTE"], [6, "FORTE"], [9, "LEVE"], [10, "FORTE"]]);
checar("por pedido: o principal em caixa alta vence o mais novo em caixa baixa", porPedido.get(1)?.nfe, "Avenida Ipiranga, 1000 — Porto Alegre/RS — CEP 90160-093");
checar("por pedido: com pagador, a NF-e e do endereco DELE", porPedido.get(4)?.texto, "Entrega em Porto Alegre/RS, diferente do endereço da NF-e (Caxias do Sul/RS)");

// ── 6. leitura ──────────────────────────────────────────────────────────────
checar("leitura pronta: a linha recebe o aviso", avisoDeRemessaDaLinha(1, { porPedido, pronta: true }).nivel, "FORTE");
checar("leitura que falhou (nao pronta): nenhum selo", [1, 4, 9].map((id) => avisoDeRemessaDaLinha(id, { porPedido, pronta: false }).nivel), ["NENHUM", "NENHUM", "NENHUM"]);
checar("pedido nao lido ou id invalido: nenhum selo", [2, 999, 0, null, undefined, Number.NaN].map((id) => avisoDeRemessaDaLinha(id as number, { porPedido, pronta: true }).nivel), ["NENHUM", "NENHUM", "NENHUM", "NENHUM", "NENHUM", "NENHUM"]);

console.log(falhas === 0 ? "\nTUDO OK" : `\n${falhas} FALHA(S)`);
process.exitCode = falhas === 0 ? 0 : 1;
