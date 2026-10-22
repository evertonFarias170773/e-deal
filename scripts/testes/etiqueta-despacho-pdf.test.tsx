/**
 * Etiqueta de despacho 10x15: nenhum texto sobrepoe outro (22/10/2026).
 *
 *   npx --yes tsx --tsconfig tsconfig.json scripts/testes/etiqueta-despacho-pdf.test.tsx
 *
 * Renderiza os PDFs REAIS (`EtiquetaPdfDocument`, `EtiquetaRetiradaPdfDocument`) com dados de teste, sem banco, e le as
 * linhas de texto de cada pagina com o pymupdf (`_etiqueta_pdf_analise.py`). Sem python/pymupdf, a parte do PDF e pulada.
 *
 *   1. A regra de ajuste (`etiqueta-ajuste-texto.ts`): texto curto = corpo cheio; nome muito longo desce em degraus
 *      ate 7 pt e, por ultimo, trunca com "…"; nunca passa da altura reservada.
 *   2. Texto curto sai IGUAL ao anterior: as linhas do PDF (texto, caixa, corpo, fonte), ordenadas, batem com o que o
 *      codigo antigo desenhava (fixtures `etiqueta-*-antes.json`, gerados do HEAD de 21/10/2026). Paginas: 1 por volume.
 *   3. O caso do 23095 (nome longo, A/C igual ao nome, endereco com "LOTE 8 E 9 SALA 3 E 4"): o desenho ANTIGO tem
 *      linhas sobrepostas (o detector as acusa) e o novo nao; QR, NF, data, volume e remetente ficam onde estavam.
 *   4. Casos extremos (nome, A/C, endereco e observacao enormes) e a etiqueta de retirada.
 */
import * as React from "react";
(globalThis as unknown as { React: unknown }).React = React;
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { renderToBuffer } from "@react-pdf/renderer";
import QRCode from "qrcode";
import { criarEtiquetaElement } from "../../src/features/expedicao/pdf/EtiquetaPdfDocument";
import { criarEtiquetaRetiradaElement } from "../../src/features/expedicao/pdf/EtiquetaRetiradaPdfDocument";
import { SITE_QR_ETIQUETA } from "../../src/features/expedicao/lib/etiqueta-apresentacao";
import {
  ALTURA_BLOCO_DESTINATARIO_PT,
  ALTURA_OBSERVACAO_PT,
  TAMANHO_MINIMO_PT,
  ajustarDestinatario,
  ajustarObservacao,
  larguraDoTexto,
  normalizarTexto,
  quebrarEmLinhas
} from "../../src/features/expedicao/lib/etiqueta-ajuste-texto";

let falhas = 0;
function confere(nome: string, ok: boolean, detalhe?: unknown) {
  console.log(`${ok ? "ok    " : "FALHOU"}  ${nome}${ok || detalhe === undefined ? "" : `  -> ${String(typeof detalhe === "string" ? detalhe : JSON.stringify(detalhe)).slice(0, 400)}`}`);
  if (!ok) falhas++;
}

// ── dados de teste
const BASE = {
  idInt: 23891,
  pedidosNoVolume: [23891],
  volumes: 1,
  pesoKg: "0,77",
  transportadora: "SEDEX",
  envioPorTransportadoraDeclarada: false,
  codigoRastreamento: "",
  obs: "",
  nfNumero: "41178",
  tipoVolume: "Envelope",
  obsEtiqueta: "",
  dataEnvio: "21/10/2026",
  remetente: { nome: "E3 BRINDES", logradouro: "RUA FELIZARDO DE FARIAS, 69", bairroCidadeUf: "BAIRRO MEDIANEIRA, Porto Alegre/RS" },
  remetenteRodape: "E3 BRINDES · Porto Alegre - RS",
  destinatario: { nome: "CLIENTE DE TESTE", idCliente: 1, telefones: { whatsapp1: "", telefoneFixo: "", whatsapp2: "" }, recebedor: "", endereco: "", bairro: "", cidadeUf: "", cep: "", documento: "", telefone: "" }
};
const comDest = (d: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ ...BASE, ...extra, destinatario: { ...BASE.destinatario, ...d } });

const NOME_23095 = "IMPRIZIL SISTEMAS DE IDENTIFICACAO E IMPRESSOS DE SEGURANCA LTDA";
const CASOS = {
  curto: comDest({ nome: "ALLARTE COMERCIO LTDA", recebedor: "", endereco: "RUA DONA NOEMIA ARECO, 132", bairro: "CENTRO", cidadeUf: "Lorena - SP", cep: "12600-460", telefone: "(51) 99999-0000" }),
  curto2: comDest(
    { nome: "ALLARTE COMERCIO LTDA", recebedor: "MARIA SOUZA", endereco: "RUA DONA NOEMIA ARECO, 132 - SALA 2", bairro: "CENTRO", cidadeUf: "Lorena - SP", cep: "12600-460", telefone: "(51) 99999-0000" },
    { idInt: 23100, pedidosNoVolume: [23100, 23101], volumes: 2, obsEtiqueta: "Produto fragil, entregar na portaria" }
  ),
  "23095": comDest(
    {
      nome: NOME_23095,
      recebedor: NOME_23095,
      endereco: "AVENIDA C4, 372 - QUADRA22                  LOTE  8 E 9               SALA  3 E 4",
      bairro: "BRO JARDIM AMERICA",
      cidadeUf: "Goiânia - GO",
      cep: "74265-040",
      telefone: "(62) 3100-4253"
    },
    { idInt: 23095, transportadora: "BRASPRESS", nfNumero: "6.685", dataEnvio: "22/10/2026", remetente: { nome: "DSEG BRASIL", logradouro: "RUA FELIZARDO DE FARIAS, 69", bairroCidadeUf: "BAIRRO MEDIANEIRA, Porto Alegre/RS" } }
  ),
  extremo: comDest(
    {
      nome: "COMPANHIA BRASILEIRA DE DISTRIBUICAO E COMERCIALIZACAO DE PRODUTOS GRAFICOS E EMBALAGENS PERSONALIZADAS DO SUL E SUDESTE LTDA",
      recebedor: "DEPARTAMENTO DE COMPRAS E SUPRIMENTOS - ATENCAO SR JOAO CARLOS DE ALMEIDA E SILVA NETO",
      endereco: "AVENIDA PRESIDENTE JUSCELINO KUBITSCHEK DE OLIVEIRA, 12345 - BLOCO C TORRE 2 ANDAR 14 SALA 1408 E 1409 - CONDOMINIO EMPRESARIAL",
      bairro: "JARDIM AMERICA DO SUL PAULISTA",
      cidadeUf: "Goiânia - GO",
      cep: "74265-040",
      telefone: "(62) 3100-4253"
    },
    { obsEtiqueta: "ENTREGAR SOMENTE NO HORARIO COMERCIAL, FALAR COM O SETOR DE RECEBIMENTO, LIGAR ANTES DE CHEGAR E EXIGIR ASSINATURA" }
  )
};

// ── 1. a regra, sem PDF
console.log("== 1. a regra de ajuste ==");
{
  confere("espacos repetidos viram um so", normalizarTexto("QUADRA22        LOTE  8 E 9 ") === "QUADRA22 LOTE 8 E 9");
  confere("a medicao usa a largura real da Helvetica (A = 667, espaco = 278)", Math.abs(larguraDoTexto("A A", "Helvetica", 1000) - (667 + 278 + 667)) < 1);
  confere("bold e mais largo que regular", larguraDoTexto("IMPRIZIL", "Helvetica-Bold", 12) > larguraDoTexto("IMPRIZIL", "Helvetica", 12));
  const curto = ajustarDestinatario({ nome: "ALLARTE COMERCIO LTDA", recebedor: "", endereco: "RUA DONA NOEMIA ARECO, 132", bairro: "CENTRO", telefoneLinha: "Fone: (51) 99999-0000" });
  confere("texto curto: corpo cheio (12 pt o nome, 10 pt o resto), sem reducao nem corte", curto.reducaoPt === 0 && !curto.truncado && curto.campos[0].tamanho === 12 && curto.campos.slice(1).every((c) => c.tamanho === 10), curto);
  confere("texto curto: uma linha por campo", curto.campos.every((c) => c.linhas === 1));
  const d = ajustarDestinatario({ nome: NOME_23095, recebedor: NOME_23095, endereco: CASOS["23095"].destinatario.endereco, bairro: "BRO JARDIM AMERICA", telefoneLinha: "Fone: (62) 3100-4253" });
  confere("23095: cabe na altura reservada, sem cortar nada", d.alturaPt <= ALTURA_BLOCO_DESTINATARIO_PT && !d.truncado, d);
  confere("23095: os corpos desceram em degraus, nunca abaixo de 7 pt", d.reducaoPt > 0 && d.campos.every((c) => c.tamanho >= TAMANHO_MINIMO_PT), d.campos.map((c) => c.tamanho));
  confere("23095: o endereco sai em UMA linha, com o complemento inteiro", d.campos.find((c) => c.id === "endereco")!.texto === "AVENIDA C4, 372 - QUADRA22 LOTE 8 E 9 SALA 3 E 4");
  const x = ajustarDestinatario({
    nome: CASOS.extremo.destinatario.nome as string,
    recebedor: CASOS.extremo.destinatario.recebedor as string,
    endereco: CASOS.extremo.destinatario.endereco as string,
    bairro: CASOS.extremo.destinatario.bairro as string,
    telefoneLinha: "Fone: (62) 3100-4253"
  });
  confere("extremo: ainda cabe na altura reservada, so com a fonte descendo (nada cortado) e nunca abaixo de 7 pt", x.alturaPt <= ALTURA_BLOCO_DESTINATARIO_PT && x.campos.every((c) => c.tamanho >= TAMANHO_MINIMO_PT) && !x.truncado, x.campos.map((c) => [c.id, c.tamanho, c.linhas, c.truncado]));
  const infinito = "PALAVRA ".repeat(80).trim();
  const t = ajustarDestinatario({ nome: infinito, recebedor: infinito, endereco: infinito, bairro: infinito, telefoneLinha: "Fone: (62) 3100-4253" });
  confere("texto impossivel de caber: truncamento controlado, dentro da altura, nunca abaixo de 7 pt, marcado com reticencias", t.alturaPt <= ALTURA_BLOCO_DESTINATARIO_PT && t.truncado && t.campos.every((c) => c.tamanho >= TAMANHO_MINIMO_PT) && t.campos.some((c) => c.truncado && c.texto.endsWith("…")), t.campos.map((c) => [c.id, c.tamanho, c.linhas, c.truncado]));
  confere("texto impossivel: o telefone, o bairro e o nome nao somem (ao menos uma linha cada)", t.campos.length === 5 && t.campos.every((c) => c.linhas >= 1));
  confere("texto impossivel: cada campo ocupa exatamente as linhas que a regra contou", t.campos.every((c) => quebrarEmLinhas(c.texto, c.id === "nome" ? "Helvetica-Bold" : "Helvetica", c.tamanho, 243.46).length === c.linhas));
  confere("extremo: o que se corta primeiro e o A/C; o nome so por ultimo", x.campos.find((c) => c.id === "recebedor")!.linhas <= x.campos.find((c) => c.id === "nome")!.linhas, x.campos.map((c) => [c.id, c.linhas]));
  confere("extremo: cada campo, na largura util, ocupa exatamente as linhas que a regra contou", x.campos.every((c) => quebrarEmLinhas(c.texto, c.id === "nome" ? "Helvetica-Bold" : "Helvetica", c.tamanho, 243.46).length === c.linhas));
  const o = ajustarObservacao("ENTREGAR SOMENTE NO HORARIO COMERCIAL, FALAR COM O SETOR DE RECEBIMENTO, LIGAR ANTES DE CHEGAR E EXIGIR ASSINATURA".slice(0, 105));
  confere("observacao de 105 caracteres cabe na altura reservada (3 linhas a 7 pt no pior caso)", o.alturaPt <= ALTURA_OBSERVACAO_PT && o.campos[0].tamanho >= TAMANHO_MINIMO_PT, o);
  const oc = ajustarObservacao("PRODUTO FRAGIL");
  confere("observacao curta: corpo cheio (9 pt)", oc.campos[0].tamanho === 9 && oc.reducaoPt === 0);
}

// ── 2..4. os PDFs
type Linha = { texto: string; x0: number; y0: number; x1: number; y1: number; base: number; corpo: number; fonte: string };
const AQUI = path.join(process.cwd(), "scripts", "testes");
const ANALISE = path.join(AQUI, "_etiqueta_pdf_analise.py");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "etiqueta-"));

function analisar(pdf: Buffer, nome: string): Linha[][] | null {
  const arquivo = path.join(TMP, `${nome}.pdf`);
  fs.writeFileSync(arquivo, pdf);
  for (const py of ["python", "python3", "py"]) {
    try {
      const saida = execFileSync(py, [ANALISE, arquivo], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 1 << 26 });
      return JSON.parse(saida) as Linha[][];
    } catch {
      /* tenta o proximo */
    }
  }
  return null;
}

/** Duas linhas sobrepostas: se cruzam na horizontal e a de baixo tem a linha de base a menos de 0,8x do seu corpo da de cima. */
function sobreposicoes(linhas: Linha[]): string[] {
  const achadas: string[] = [];
  for (let i = 0; i < linhas.length; i++) {
    for (let j = 0; j < linhas.length; j++) {
      if (i === j) continue;
      const a = linhas[i];
      const b = linhas[j];
      if (b.base <= a.base) continue; // b abaixo de a
      const cruzam = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > 1;
      if (cruzam && b.base - a.base < 0.8 * b.corpo && b.base - a.base > -1) achadas.push(`"${a.texto}" x "${b.texto}"`);
    }
  }
  return achadas;
}

const chave = (l: Linha) => JSON.stringify([l.texto, l.x0, l.y0, l.x1, l.y1, l.base, l.corpo, l.fonte]);
const ordenado = (ls: Linha[]) => ls.map(chave).sort();

const fixture = (nome: string) => JSON.parse(fs.readFileSync(path.join(AQUI, "fixtures", `etiqueta-${nome}-antes.json`), "utf8")) as Linha[][];
async function pdfs() {
const qr = await QRCode.toDataURL(SITE_QR_ETIQUETA, { margin: 0, width: 256 });
const render = async (vm: unknown) => renderToBuffer(criarEtiquetaElement(vm as never, qr));

const pdfCurto = analisar(await render(CASOS.curto), "curto");
if (!pdfCurto) {
  console.log("\nsem python/pymupdf: a parte do PDF foi pulada.");
} else {
  console.log("== 2. texto curto sai igual ao de antes ==");
  for (const nome of ["curto", "curto2"] as const) {
    const novo = analisar(await render(CASOS[nome]), nome)!;
    const antes = fixture(nome);
    confere(`${nome}: ${antes.length} pagina(s), uma por volume`, novo.length === antes.length && novo.length === (CASOS[nome] as { volumes: number }).volumes, [novo.length, antes.length]);
    confere(`${nome}: mesmas linhas (texto, caixa, corpo, fonte), ordem dos objetos ignorada`, novo.every((p, i) => JSON.stringify(ordenado(p)) === JSON.stringify(ordenado(antes[i]))), novo.map((p, i) => ordenado(p).filter((c) => !ordenado(antes[i]).includes(c))));
    confere(`${nome}: nenhuma sobreposicao`, novo.every((p) => sobreposicoes(p).length === 0), novo.map(sobreposicoes));
  }

  console.log("== 3. o caso do 23095 ==");
  const antes = fixture("23095")[0];
  const defeitos = sobreposicoes(antes);
  confere("o desenho ANTIGO tem linhas sobrepostas (o detector as acusa)", defeitos.length >= 3, defeitos);
  const novo = analisar(await render(CASOS["23095"]), "23095")!;
  confere("o novo: 1 pagina", novo.length === 1, novo.length);
  confere("o novo: nenhuma linha sobreposta", sobreposicoes(novo[0]).length === 0, sobreposicoes(novo[0]));
  const dest = novo[0].filter((l) => l.y0 > 60 && l.base < 160 && !/^(CEP|CIDADE)/.test(l.texto));
  const rotuloCep = novo[0].find((l) => l.texto.startsWith("CEP:"))!;
  confere("o bloco do destinatario termina acima do CEP (nada invade o bloco de baixo)", Math.max(...dest.map((l) => l.base)) < rotuloCep.y0, [Math.max(...dest.map((l) => l.base)), rotuloCep.y0]);
  confere("todos os corpos do bloco ficaram >= 7 pt", dest.every((l) => l.corpo >= TAMANHO_MINIMO_PT), dest.map((l) => l.corpo));
  const textoDest = dest.map((l) => l.texto).join(" ");
  confere("nome, A/C, endereco com complemento, bairro e fone saem INTEIROS", textoDest.includes("SEGURANCA LTDA") && textoDest.includes("LOTE 8 E 9 SALA 3 E 4") && textoDest.includes("BRO JARDIM AMERICA") && textoDest.includes("(62) 3100-4253"), textoDest);
  const rodape = (ls: Linha[]) => ls.filter((l) => l.base > 340).map(chave).sort();
  const abaixoDoBloco = (ls: Linha[]) => ls.filter((l) => /^(SITE|DATA DE ENVIO|NF:|VOLUME)/.test(l.texto) || /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(l.texto) || /^\d+\/\d+$/.test(l.texto) || l.texto === "6.685").map(chave).sort();
  confere("QR, data de envio, NF e volume ficam exatamente onde estavam", JSON.stringify(abaixoDoBloco(novo[0])) === JSON.stringify(abaixoDoBloco(antes)) && abaixoDoBloco(novo[0]).length >= 6, abaixoDoBloco(novo[0]).length);
  confere("o rodape inteiro (a partir do QR) e identico ao de antes", JSON.stringify(rodape(novo[0])) === JSON.stringify(rodape(antes)));
  const naoDest = (ls: Linha[]) => ls.filter((l) => l.y0 >= 150).map((l) => l.texto + l.corpo).sort();
  confere("CEP, cidade, forma de envio e remetente mantem texto e corpo (so descem junto do bloco)", JSON.stringify(naoDest(novo[0])) === JSON.stringify(naoDest(antes)));

  console.log("== 4. extremos e retirada ==");
  const ext = analisar(await render(CASOS.extremo), "extremo")!;
  confere("extremo: 1 pagina", ext.length === 1);
  confere("extremo: nenhuma linha sobreposta", sobreposicoes(ext[0]).length === 0, sobreposicoes(ext[0]));
  confere("extremo: o rodape fica no pe (VOLUME na mesma linha de base do curto)", ext[0].find((l) => l.texto === "VOLUME:")?.base === pdfCurto[0].find((l) => l.texto === "VOLUME:")?.base);
  const rotuloCep2 = ext[0].find((l) => l.texto.startsWith("CEP:"))!;
  const destExt = ext[0].filter((l) => l.y0 > 60 && l.base < rotuloCep2.y0 && l.base > 70);
  confere("extremo: o bloco do destinatario termina acima do CEP e todos os corpos >= 7 pt", Math.max(...destExt.map((l) => l.base)) < rotuloCep2.y0 && destExt.every((l) => l.corpo >= TAMANHO_MINIMO_PT), destExt.map((l) => [l.corpo, l.texto.slice(0, 20)]));
  const rotuloObs = ext[0].find((l) => l.texto.startsWith("OBSERVA"))!;
  const rotuloRem = ext[0].find((l) => l.texto.startsWith("REMETENTE:"))!;
  const obs = ext[0].filter((l) => l.base > rotuloObs.base + 1 && l.base < rotuloRem.y0);
  confere("extremo: a observacao sai em corpo >= 7 pt, de 1 a 3 linhas, entre o rotulo e o remetente", obs.length >= 1 && obs.length <= 3 && obs.every((l) => l.corpo >= TAMANHO_MINIMO_PT), obs.map((l) => [l.corpo, l.texto]));
  const ultimoRemetente = ext[0].filter((l) => l.texto.startsWith("BAIRRO MEDIANEIRA"))[0];
  const qrSite = ext[0].find((l) => l.texto === "SITE:")!;
  confere("extremo: o remetente termina acima do rodape (nada invade o QR)", ultimoRemetente !== undefined && ultimoRemetente.base < qrSite.y0, [ultimoRemetente?.base, qrSite.y0]);

  const ret = { idInt: 23095, volumes: 1, cliente: { nome: NOME_23095, telefone: "(62) 3100-4253" }, prontoEm: "21/10/2026", remetenteRodape: "E3 BRINDES · Porto Alegre - RS" };
  const retPdf = analisar(await renderToBuffer(criarEtiquetaRetiradaElement(ret as never)), "retirada")!;
  confere("retirada (nome do 23095): 1 pagina e nenhuma sobreposicao", retPdf.length === 1 && sobreposicoes(retPdf[0]).length === 0, sobreposicoes(retPdf[0]));
  const retLongo = analisar(await renderToBuffer(criarEtiquetaRetiradaElement({ ...ret, cliente: { nome: (CASOS.extremo.destinatario.nome as string) + " " + (CASOS.extremo.destinatario.recebedor as string), telefone: "(62) 3100-4253" } } as never)), "retirada-longa")!;
  confere("retirada (nome enorme): 1 pagina, nenhuma sobreposicao e o telefone aparece", retLongo.length === 1 && sobreposicoes(retLongo[0]).length === 0 && retLongo[0].some((l) => l.texto.includes("3100-4253")), sobreposicoes(retLongo[0]));
}

}

pdfs()
  .catch((e) => {
    console.error(e);
    falhas++;
  })
  .finally(() => {
    fs.rmSync(TMP, { recursive: true, force: true });
    console.log(falhas === 0 ? "\nTUDO OK" : `\n${falhas} FALHA(S)`);
    process.exitCode = falhas === 0 ? 0 : 1;
  });
