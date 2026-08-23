/**
 * Testes da linha de endereco do bloco 8 (Resumo do orcamento).
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs scripts/testes/resumo-endereco-orcamento.test.mts
 *
 * Os valores abaixo NAO sao inventados: saem dos 2.604 enderecos que
 * `propostas.id_endereco_ent` aponta em producao, levantados em 23/08/2026.
 * A distribuicao medida naquele dia, que e o que estes casos cobrem:
 *
 *   tipo      PRINCIPAL 2.497 propostas | ENTREGA 107 | nenhum outro tipo
 *   CEP       so digitos 2.510 | ja com traco 91 | com ponto 1 | vazio 0
 *   cidade    sem cidade 0 | sem UF 0 | sem tipo 0
 *
 * Ou seja: os ramos de campo vazio existem por defesa, nao por frequencia. Eles
 * ficam testados porque a leitura tolerante e justamente o que impede a linha de
 * dizer bobagem quando o cadastro vier torto.
 *
 * Rode depois de mexer em src/features/orcamentos/orcamento-utils.ts.
 */
import {
  resumirEnderecoDoOrcamento,
  rotuloTipoEndereco
} from "../../src/features/orcamentos/orcamento-utils.ts";
import type { CadastroEndereco } from "../../src/features/cadastros/types.ts";

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

/** Endereco no formato que chega a tela, com os campos que a linha usa. */
function endereco(parcial: Partial<CadastroEndereco> & Record<string, unknown>): CadastroEndereco {
  return {
    id: "end_1",
    tipo: "principal",
    cep: "",
    endereco: "",
    numero: "",
    bairro: "",
    cidade: "",
    uf: "",
    ...parcial
  } as CadastroEndereco;
}

// ── rotuloTipoEndereco: as tres grafias que o tipo tem no caminho real ────────
// `tipo` minusculo e o que os dois mapeamentos produzem; `tipo_endereco` cru,
// em caixa alta ou capitalizado, e o que aparece quando a linha do banco chega
// sem passar por eles. Comparar sem normalizar erra em duas das tres.
console.log("\n— rotulo do tipo —");
checar("tipo minusculo (mapeado)", rotuloTipoEndereco(endereco({ tipo: "principal" })), "Principal");
checar("tipo entrega minusculo", rotuloTipoEndereco(endereco({ tipo: "entrega" })), "Entrega");
checar("tipo_endereco PRINCIPAL cru", rotuloTipoEndereco(endereco({ tipo_endereco: "PRINCIPAL" })), "Principal");
checar("tipo_endereco ENTREGA cru", rotuloTipoEndereco(endereco({ tipo_endereco: "ENTREGA" })), "Entrega");
checar("tipo_endereco Principal capitalizado", rotuloTipoEndereco(endereco({ tipo_endereco: "Principal" })), "Principal");
checar("tipo_endereco com espaco em volta", rotuloTipoEndereco(endereco({ tipo_endereco: "  PRINCIPAL  " })), "Principal");
checar("tipo_endereco vence tipo", rotuloTipoEndereco(endereco({ tipo_endereco: "ENTREGA", tipo: "principal" })), "Entrega");
checar("cobranca acentua", rotuloTipoEndereco(endereco({ tipo: "cobranca" })), "Cobrança");
checar("fiscal", rotuloTipoEndereco(endereco({ tipo: "fiscal" })), "Fiscal");
checar("tipo desconhecido nao vira Principal", rotuloTipoEndereco(endereco({ tipo_endereco: "OBRA" })), "Obra");
checar("sem tipo nao inventa rotulo", rotuloTipoEndereco(endereco({ tipo: "" as CadastroEndereco["tipo"] })), null);

// ── O caso PRINCIPAL: proposta #21086 de producao ────────────────────────────
console.log("\n— endereco principal (proposta 21086) —");
checar(
  "principal com CEP ja formatado",
  resumirEnderecoDoOrcamento({
    endereco: endereco({ tipo_endereco: "PRINCIPAL", cidade: "Santa Cruz do Sul", uf: "RS", cep: "96810-400" })
  }),
  { cidadeUf: "Santa Cruz do Sul/RS", cep: "96810-400", rotulo: "Principal" }
);

// ── O caso ENTREGA: proposta #21078 de producao ──────────────────────────────
console.log("\n— endereco de entrega (proposta 21078) —");
checar(
  "entrega e nomeada como entrega",
  resumirEnderecoDoOrcamento({
    endereco: endereco({ tipo_endereco: "ENTREGA", cidade: "Garanhuns", uf: "PE", cep: "55293-050" })
  }),
  { cidadeUf: "Garanhuns/PE", cep: "55293-050", rotulo: "Entrega" }
);

// ── CEP: os tres formatos que existem em producao ────────────────────────────
console.log("\n— formatos de CEP —");
// 2.510 dos 2.604 estao assim: e o caso que a formatacao melhora.
checar(
  "so digitos ganha o traco",
  resumirEnderecoDoOrcamento({ endereco: endereco({ cidade: "Porto Alegre", uf: "RS", cep: "90620130" }) })?.cep,
  "90620-130"
);
// 91 ja vem com traco: tem de sair igual, sem traco duplicado.
checar(
  "ja com traco sai igual",
  resumirEnderecoDoOrcamento({ endereco: endereco({ cep: "90620-130" }) })?.cep,
  "90620-130"
);
// O unico fora de padrao em producao: 92.200-290, em Canoas/RS.
checar(
  "com ponto e normalizado",
  resumirEnderecoDoOrcamento({ endereco: endereco({ cidade: "Canoas", uf: "RS", cep: "92.200-290" }) })?.cep,
  "92200-290"
);
checar(
  "CEP curto sai como veio, sem mascara torta",
  resumirEnderecoDoOrcamento({ endereco: endereco({ cep: "906" }) })?.cep,
  "906"
);
checar("sem CEP fica vazio", resumirEnderecoDoOrcamento({ endereco: endereco({ cep: "" }) })?.cep, "");

// ── UF e cidade ──────────────────────────────────────────────────────────────
console.log("\n— cidade e UF —");
checar(
  "UF minuscula sobe para caixa alta",
  resumirEnderecoDoOrcamento({ endereco: endereco({ cidade: "Toledo", uf: "pr" }) })?.cidadeUf,
  "Toledo/PR"
);
checar(
  "so cidade nao deixa barra solta",
  resumirEnderecoDoOrcamento({ endereco: endereco({ cidade: "Toledo", uf: "" }) })?.cidadeUf,
  "Toledo"
);
checar(
  "so UF nao deixa barra solta",
  resumirEnderecoDoOrcamento({ endereco: endereco({ cidade: "", uf: "PR" }) })?.cidadeUf,
  "PR"
);

// ── Nenhum endereco escolhido ────────────────────────────────────────────────
// 5.707 propostas em producao estao sem id_endereco_ent. E o caso que precisa
// de aviso, e nao de espaco em branco.
console.log("\n— sem endereco escolhido —");
checar("sem endereco devolve null", resumirEnderecoDoOrcamento({}), null);
checar("endereco undefined devolve null", resumirEnderecoDoOrcamento({ endereco: undefined }), null);

// Endereco escolhido porem capenga NAO e a mesma coisa que endereco ausente: a
// tela precisa dizer "escolhi um endereco sem cidade", nao "nao ha endereco".
checar(
  "endereco vazio nao vira ausencia",
  resumirEnderecoDoOrcamento({ endereco: endereco({ cidade: "", uf: "", cep: "" }) }),
  { cidadeUf: "", cep: "", rotulo: "Principal" }
);

// ── Orcamento rapido: nao ha cadastro, o destino vem dos campos livres ───────
console.log("\n— orcamento rapido (cliente nao cadastrado) —");
checar(
  "campos livres viram destino, sem rotulo",
  resumirEnderecoDoOrcamento({
    clienteNaoCadastrado: true,
    cidadeLivre: "Porto Alegre",
    ufLivre: "rs",
    cepLivre: "90620130"
  }),
  { cidadeUf: "Porto Alegre/RS", cep: "90620-130", rotulo: null }
);
checar(
  "so CEP digitado ja e destino",
  resumirEnderecoDoOrcamento({ clienteNaoCadastrado: true, cepLivre: "90620130" }),
  { cidadeUf: "", cep: "90620-130", rotulo: null }
);
checar(
  "rapido sem nada digitado avisa que falta endereco",
  resumirEnderecoDoOrcamento({ clienteNaoCadastrado: true }),
  null
);
checar(
  "rapido so com espacos tambem avisa",
  resumirEnderecoDoOrcamento({ clienteNaoCadastrado: true, cidadeLivre: "  ", ufLivre: " ", cepLivre: "  " }),
  null
);
// O cadastro fica ignorado no modo rapido: quem manda ali sao os campos livres.
checar(
  "rapido ignora endereco de cadastro que tenha sobrado",
  resumirEnderecoDoOrcamento({
    clienteNaoCadastrado: true,
    cidadeLivre: "Canoas",
    ufLivre: "RS",
    endereco: endereco({ cidade: "Toledo", uf: "PR", cep: "85902040" })
  }),
  { cidadeUf: "Canoas/RS", cep: "", rotulo: null }
);

console.log(falhas === 0 ? "\nTUDO OK" : `\n${falhas} FALHA(S)`);
process.exit(falhas === 0 ? 0 : 1);
