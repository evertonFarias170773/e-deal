/**
 * Percentual aproximado dos tributos do Simples Nacional (Lei 12.741) da NFS-e
 * (05/11/2026). Vai para a Focus em `percentual_total_tributos_simples_nacional`
 * (tag pTotTribSN). Um valor por empresa e por mês de vigência, cadastrado pelo
 * financeiro em Configurações → Empresas (tabela `empresas_percentual_simples`).
 *
 * Vale o percentual do MÊS DA EMISSÃO, no horário de Brasília. Sem percentual
 * cadastrado para o mês, a nota não é emitida: nada de repetir o mês anterior.
 *
 * Regras puras: sem banco, sem tela. Teste: scripts/testes/nfse-percentual-simples.test.mts
 */

const FUSO = "America/Sao_Paulo";

/** O mês de vigência de uma data, como o banco guarda: "AAAA-MM-01", no horário de Brasília. */
export function competenciaDaData(data: Date): string {
  const partes = new Intl.DateTimeFormat("en-CA", { timeZone: FUSO, year: "numeric", month: "2-digit" }).formatToParts(data);
  const ano = partes.find((p) => p.type === "year")?.value ?? "0000";
  const mes = partes.find((p) => p.type === "month")?.value ?? "00";
  return `${ano}-${mes}-01`;
}

/** "2026-11-01" → "11/2026". Texto que não é mês volta como veio. */
export function rotuloDaCompetencia(competencia: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(String(competencia ?? ""));
  return m ? `${m[2]}/${m[1]}` : String(competencia ?? "");
}

/** "11/2026" ou "2026-11" → "2026-11-01". Mês inválido dá null. */
export function competenciaDoTexto(texto: string): string | null {
  const t = String(texto ?? "").trim();
  let ano: number;
  let mes: number;
  let m = /^(\d{1,2})\/(\d{4})$/.exec(t);
  if (m) {
    mes = Number(m[1]);
    ano = Number(m[2]);
  } else {
    m = /^(\d{4})-(\d{1,2})(?:-01)?$/.exec(t);
    if (!m) return null;
    ano = Number(m[1]);
    mes = Number(m[2]);
  }
  if (!(mes >= 1 && mes <= 12) || !(ano >= 2000 && ano <= 2100)) return null;
  return `${ano}-${String(mes).padStart(2, "0")}-01`;
}

export type PercentualConferido = { ok: true; valor: number } | { ok: false; mensagem: string };

/**
 * O que o financeiro digita: "15,2", "15,20" ou "15.2". Aceita de 0,01 a 99,99,
 * com até duas casas (o campo da Focus é Decimal 2.2).
 */
export function conferirPercentual(texto: string | number | null | undefined): PercentualConferido {
  const t = String(texto ?? "").trim().replace("%", "").trim().replace(",", ".");
  if (!t) return { ok: false, mensagem: "Informe o percentual." };
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(t)) return { ok: false, mensagem: "Use até duas casas decimais, por exemplo 15,20." };
  const valor = Math.round(Number(t) * 100) / 100;
  if (!(valor > 0 && valor < 100)) return { ok: false, mensagem: "O percentual tem de ficar entre 0,01 e 99,99." };
  return { ok: true, valor };
}

/** O texto que vai à Focus: sempre duas casas, ponto decimal ("15.20"). */
export function percentualParaFocus(valor: number): string {
  return (Math.round(Number(valor) * 100) / 100).toFixed(2);
}

/** "15,20%", para a tela. */
export function percentualParaTela(valor: number): string {
  return `${percentualParaFocus(valor).replace(".", ",")}%`;
}

export type PercentualVigente =
  | { ok: true; competencia: string; percentual: number }
  | { ok: false; competencia: string; motivo: "NAO_CADASTRADO" | "LEITURA_FALHOU" };

/** Escolhe, nas linhas da empresa, a do mês pedido. Sem linha do mês: não cadastrado. */
export function escolherPercentualDoMes(
  linhas: readonly { competencia: string; percentual: number | string | null }[],
  competencia: string
): PercentualVigente {
  const linha = linhas.find((l) => String(l.competencia).slice(0, 10) === competencia);
  const valor = linha ? Number(linha.percentual) : NaN;
  if (!linha || !(valor > 0 && valor < 100)) return { ok: false, competencia, motivo: "NAO_CADASTRADO" };
  return { ok: true, competencia, percentual: Math.round(valor * 100) / 100 };
}

/** A frase que a janela e a rota mostram quando falta o percentual do mês. */
export function mensagemSemPercentual(nomeDaEmpresa: string, vigente: PercentualVigente): string {
  const mes = rotuloDaCompetencia(vigente.competencia);
  if (!vigente.ok && vigente.motivo === "LEITURA_FALHOU") {
    return `Não foi possível ler o percentual do Simples (Lei 12.741) de ${mes}. Tente de novo; a nota não sai sem ele.`;
  }
  return (
    `Sem percentual do Simples (Lei 12.741) cadastrado para ${mes} na ${nomeDaEmpresa}. ` +
    `Cadastre em Configurações → Empresas antes de emitir.`
  );
}
