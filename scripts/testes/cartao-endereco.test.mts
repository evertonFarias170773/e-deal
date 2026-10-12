/**
 * Testes do cartao fechado do endereco de entrega (box 5).
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs scripts/testes/cartao-endereco.test.mts
 *
 * Confere (1) quais campos o cartao mostra, (2) que o mesmo cartao serve ao
 * selecionado e as outras opcoes, com o destaque como unica diferenca, e (3) que
 * os boxes 3 e 4 continuam no desenho de antes.
 */
import { readFileSync } from "node:fs";
import {
  camposDoCartaoDeEndereco,
  cepExibicao,
  logradouroDe,
  semTraco
} from "../../src/features/orcamentos/lib/campos-do-endereco.ts";

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
const mapa = (e: Parameters<typeof camposDoCartaoDeEndereco>[0]) =>
  Object.fromEntries(camposDoCartaoDeEndereco(e).map((c) => [c.chave, c]));

// ── 1. Os campos ──
const completo = {
  tipo: "entrega",
  cep: "12345678",
  endereco: "Rua das Flores",
  numero: "120",
  complemento: "Sala 3",
  bairro: "Centro",
  cidade: "Curitiba",
  uf: "PR",
  obs: "Portao azul",
  recebedor: "Maria Souza",
  cpfRecebedor: "12345678909",
  ieRecebedor: "9021345-77"
};
const c = mapa(completo);
checar("endereco completo: ordem dos campos", camposDoCartaoDeEndereco(completo).map((x) => x.chave), ["endereco", "complemento", "bairro", "cidadeUf", "cep", "tipo", "recebedor", "cpfRecebedor", "ieRecebedor", "obs"]);
checar("logradouro com numero", c.endereco.valor, "Rua das Flores, 120");
checar("complemento", c.complemento.valor, "Sala 3");
checar("bairro", c.bairro.valor, "Centro");
checar("cidade / UF", c.cidadeUf.valor, "Curitiba/PR");
checar("CEP formatado", c.cep.valor, "12345-678");
checar("tipo", c.tipo.valor, "entrega");
checar("recebedor", c.recebedor.valor, "Maria Souza");
checar("CPF do recebedor formatado", c.cpfRecebedor.valor, "123.456.789-09");
checar("IE do recebedor (hoje so aparecia na edicao)", c.ieRecebedor.valor, "9021345-77");
checar("referencia", c.obs.valor, "Portao azul");
checar("nenhum campo completo sai apagado", camposDoCartaoDeEndereco(completo).filter((x) => x.apagado).length, 0);
checar("o endereco e o campo principal e ocupa 2 colunas", [c.endereco.principal, c.endereco.largura], [true, 2]);
checar("a referencia ocupa a linha inteira", c.obs.largura, "linha");

// campos que faltam: os do nucleo ficam visiveis e apagados; os opcionais nao aparecem
const minimo = camposDoCartaoDeEndereco({ endereco: "Av. Brasil" });
checar("so rua: nucleo sempre presente", minimo.map((x) => x.chave), ["endereco", "complemento", "bairro", "cidadeUf", "cep", "tipo"]);
checar("so rua: o que falta sai como traco apagado", minimo.filter((x) => x.apagado).map((x) => `${x.chave}=${x.valor}`), ["complemento=—", "bairro=—", "cidadeUf=—", "cep=—", "tipo=Tipo não informado"]);
checar("so rua: sem numero, sem virgula sobrando", mapa({ endereco: "Av. Brasil" }).endereco.valor, "Av. Brasil");
checar("recebedor, CPF, IE e referencia so aparecem se existirem", minimo.some((x) => ["recebedor", "cpfRecebedor", "ieRecebedor", "obs"].includes(x.chave)), false);
checar("so recebedor: aparece so ele", camposDoCartaoDeEndereco({ endereco: "X", recebedor: "Joao" }).slice(6).map((x) => x.chave), ["recebedor"]);
checar("complemento '-' e vazio", [mapa({ endereco: "X", complemento: "-" }).complemento.valor, mapa({ endereco: "X", complemento: "-" }).complemento.apagado], ["—", true]);
checar("complemento so com espacos e vazio", mapa({ endereco: "X", complemento: "   " }).complemento.apagado, true);
checar("CEP com menos de 8 digitos fica como veio", mapa({ endereco: "X", cep: "1234" }).cep.valor, "1234");
checar("endereco sem rua, so numero", logradouroDe({ numero: "10" }), "10");
checar("semTraco / cepExibicao (movidos da pagina)", [semTraco(" - "), semTraco("Apto 2"), cepExibicao("80010000"), cepExibicao(null)], ["", "Apto 2", "80010-000", ""]);
checar("dados internos de frete nao entram no cartao", camposDoCartaoDeEndereco(completo).some((x) => /lat|long|dist/i.test(x.chave + x.rotulo)), false);

// ── 2 e 3. Estrutura ──
const pagina = readFileSync("src/features/orcamentos/OrcamentoFormPage.tsx", "utf8").replace(/\r\n/g, "\n");
const cartao = readFileSync("src/features/orcamentos/components/CartaoEndereco.tsx", "utf8").replace(/\r\n/g, "\n");
const contar = (texto: string, trecho: string) => texto.split(trecho).length - 1;

const iFuncIni = pagina.indexOf("const renderBoxEnderecoEntrega = () =>");
const iFuncFim = pagina.indexOf('return (\n    <div className="space-y-6">\n      <PageHeader', iFuncIni);
const box5 = pagina.slice(iFuncIni, iFuncFim);
checar("o box 5 desenha pelo cartao unico (renderCartao + CartaoEndereco)", [contar(box5, "renderCartao={"), contar(box5, "<CartaoEndereco")], [1, 1]);
checar("o box 5 nao usa mais painel/linha/cores do desenho antigo", ["painel={", "linha={", "extraClassNameForItem={"].map((t) => box5.includes(t)), [false, false, false]);
checar("o box 5 segue com troca, edicao, copia, badges e busca", ["onSelect={handleSelectEndereco}", "onEdit={", "onCopy={", "badgeForItem={", "searchTextForItem={"].map((t) => box5.includes(t)), [true, true, true, true, true]);
checar('"Salvar endereço" continua uma vez so', contar(pagina, "Salvar endereço"), 1);
checar("o destaque e a unica diferenca: o cartao recebe destaque e onClick, nao outro layout", box5.includes("destaque={opcoes.destaque}") && box5.includes("onClick={opcoes.onClick}"), true);

const chamadas = pagina.split("<SelectorPainel").length - 1;
checar("ha 3 seletores (boxes 3, 4 e 5)", chamadas, 3);
checar("so um deles usa o cartao proprio (o box 5)", contar(pagina, "renderCartao={"), 1);
checar("os boxes 3 e 4 seguem com painel e linha de antes", contar(pagina, "painel={"), 2);

const semComentarios = cartao.replace(/\/\*[\s\S]*?\*\//g, "");
checar("o destaque e UM par de cores, o do sistema (fundo escuro e texto branco), aplicado so no contêiner", contar(semComentarios, '"border-[#0b2f4a] bg-[#0b2f4a] text-white"'), 1);
checar("fora do contêiner nao ha cor fixa de texto (rotulos, valores e botoes herdam)", [/text-white/.test(semComentarios.replace('"border-[#0b2f4a] bg-[#0b2f4a] text-white"', "")), /bg-\[#0b2f4a\]/.test(semComentarios.replace('"border-[#0b2f4a] bg-[#0b2f4a] text-white"', ""))], [false, false]);
// Selos: layout so no cartao (cores, textos e regras de quando aparecem vem de badgeForItem, na pagina)
const iLinha = semComentarios.indexOf("{badge ? (");
const linhaDosSelos = semComentarios.slice(iLinha, semComentarios.indexOf("{badge}", iLinha));
checar("os selos ficam numa linha propria com flex-wrap", linhaDosSelos.includes("flex flex-wrap"), true);
checar("o grupo de selos vira item da linha (div com display: contents)", linhaDosSelos.includes("[&>div]:contents"), true);
checar("cada selo e retangulo arredondado, nao pilula", [linhaDosSelos.includes("[&_span]:rounded-md"), linhaDosSelos.includes("rounded-full")], [true, false]);
checar("os dois selos tem a mesma altura (o vermelho ganha borda transparente como a do azul)", linhaDosSelos.includes("[&_span.bg-red-500]:border-transparent"), true);
checar("a linha dos selos esta FORA da coluna entre o icone e os botoes (usa a largura inteira do cartao)", semComentarios.indexOf("{badge ? (") > semComentarios.indexOf("</dl>") - 99999 && semComentarios.indexOf("{badge ? (") < semComentarios.indexOf("<dl "), true);
checar("fonte e altura uniformes nos selos", ["[&_span]:text-[10px]", "[&_span]:font-semibold", "[&_span]:leading-4", "[&_span]:min-h-6"].map((c) => linhaDosSelos.includes(c)), [true, true, true, true]);
checar("texto do selo quebra so se nao couber (max-w-full, sem nowrap)", [linhaDosSelos.includes("[&_span]:max-w-full"), linhaDosSelos.includes("whitespace-nowrap")], [true, false]);
checar("a linha dos selos fica abaixo do cabecalho, na coluna do texto", semComentarios.indexOf("{badge ? (") > semComentarios.indexOf("{destaque ? \"Selecionado\" : \"Opção\"}"), true);
checar("o selo azul do selecionado ganha fundo solido no tema escuro (nao some no azul claro)", linhaDosSelos.includes("dark:[&_span.bg-blue-100]:!bg-[color-mix(in_srgb,#60a5fa_16%,var(--card))]"), true);
// os selos em si nao foram mexidos: mesmos textos, cores e regras na pagina
checar("selos na pagina: textos e cores intactos", ["Endereço de sócio", "Endereço de vínculo comercial", "REQUER NOTA DE TRANSPORTE", "bg-blue-100 px-2 py-0.5 text-[10px] font-semibold text-blue-800", "bg-red-500 px-2 py-0.5 text-[10px] font-bold text-white"].map((c) => pagina.includes(c)), [true, true, true, true, true]);
checar("o cartao tem os botoes Copiar e Editar", cartao.includes('aria-label="Copiar endereço"') && cartao.includes('aria-label="Editar"'), true);
checar("opcao clicavel tem role=option e teclado", cartao.includes('role: "option"') && cartao.includes('event.key === "Enter"'), true);

if (falhas > 0) {
  console.log(`\n${falhas} falha(s).`);
  process.exitCode = 1;
} else {
  console.log("\nTudo certo.");
}
