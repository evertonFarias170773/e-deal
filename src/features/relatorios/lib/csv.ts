import { formatDataCivil } from "@/lib/formatters/date";
import type { ColunaDef, LinhaRelatorio } from "../types";

/** Texto de uma célula como o Excel em português lê: vírgula decimal, data dd/mm/aaaa. */
function celulaCsv(coluna: ColunaDef, valor: string | number | null | undefined) {
  if (valor === null || valor === undefined || valor === "") return "";
  // Texto na célula de número (ex.: "1224 vendas" no total) segue como está.
  if (typeof valor === "string" && (coluna.tipo === "moeda" || coluna.tipo === "inteiro" || coluna.tipo === "percentual")) return valor;
  if (coluna.tipo === "moeda" || coluna.tipo === "percentual") return Number(valor).toFixed(2).replace(".", ",");
  if (coluna.tipo === "inteiro") return String(Math.trunc(Number(valor)));
  if (coluna.tipo === "data") return formatDataCivil(String(valor));
  return String(valor);
}

function escapar(texto: string) {
  // Ponto e vírgula é o separador: quem o contém, ou aspas e quebra de linha, vai entre aspas.
  return /[";\r\n]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
}

/**
 * CSV do que a tela mostra, na ordem da tabela, com a linha de total no fim.
 * Separador `;` e BOM no começo para o Excel em português abrir com acento e colunas certas.
 */
export function montarCsv(
  colunas: ColunaDef[],
  linhas: LinhaRelatorio[],
  total: Record<string, string | number | null>
) {
  const cabecalho = colunas.map((c) => escapar(c.titulo)).join(";");
  const corpo = linhas.map((linha) =>
    colunas.map((c) => escapar(celulaCsv(c, linha[c.id]))).join(";")
  );
  const linhaTotal = colunas
    .map((c, i) => escapar(i === 0 && total[c.id] === undefined ? "TOTAL" : celulaCsv(c, total[c.id])))
    .join(";");
  return `﻿${[cabecalho, ...corpo, linhaTotal].join("\r\n")}\r\n`;
}

export function baixarCsv(nomeArquivo: string, conteudo: string) {
  const blob = new Blob([conteudo], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nomeArquivo;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
