"use client";

import { conferirTamanhoDaObservacao } from "@/features/fiscal/lib/observacao-nota-fiscal";

/**
 * "Observação para a nota fiscal" (`propostas.obs_nota_fiscal`, 11/11/2026).
 *
 * O MESMO campo aparece em dois lugares da proposta: no bloco "4. Dados para
 * nota fiscal" da aba Geral e na aba "Produção / Expedição / Notas". Os dois
 * leem e escrevem `form.obsNotaFiscal`, então editar num muda o outro, e o
 * Salvar grava uma coluna só.
 */
export function CampoObservacaoNotaFiscal({
  valor,
  idInt,
  aoMudar,
  inputClassName,
  onde
}: {
  valor: string;
  idInt: number | string | null | undefined;
  aoMudar: (valor: string) => void;
  inputClassName: string;
  onde: "geral" | "producao";
}) {
  const conferencia = conferirTamanhoDaObservacao(valor, idInt);
  const passou = conferencia.nfe.passou || conferencia.nfse.passou;
  const idCampo = `obs-nota-fiscal-${onde}`;
  return (
    <div className="space-y-2" data-campo-obs-nota-fiscal={onde}>
      <label htmlFor={idCampo} className="block text-xs font-bold uppercase tracking-wide text-slate-600 dark:text-slate-300">
        Observação para a nota fiscal
      </label>
      <textarea
        id={idCampo}
        value={valor}
        onChange={(event) => aoMudar(event.target.value)}
        className={`${inputClassName} min-h-24 resize-y`}
        placeholder="Ex: Projeto Festival de Inverno - PRONAC 123456 (Lei Rouanet)"
      />
      <p className="text-xs leading-5 text-slate-500 dark:text-slate-400">
        Sai impresso nas <strong>Informações Complementares</strong> da NF-e e da NFS-e do pedido, depois do que
        já sai hoje. O faturamento vê o texto já preenchido na janela da nota e pode revisar antes de emitir. As{" "}
        <strong>Observações e Condições</strong> (bloco 10) continuam internas e não vão para a nota.
        {onde === "geral" ? " O mesmo campo está na aba Produção / Expedição / Notas." : " O mesmo campo está no bloco 4 da aba Geral."}
      </p>
      {valor.trim() ? (
        <p
          className={`text-xs font-semibold ${passou ? "text-red-600 dark:text-red-400" : "text-slate-500 dark:text-slate-400"}`}
          data-tamanho-obs-nota-fiscal
          role={passou ? "alert" : undefined}
        >
          NF-e: {conferencia.nfe.tamanho} de {conferencia.nfe.limite.toLocaleString("pt-BR")} caracteres (com o &quot;Pedido N&quot;)
          {" · "}NFS-e: {conferencia.nfse.tamanho} de {conferencia.nfse.limite.toLocaleString("pt-BR")}
          {passou
            ? conferencia.nfse.passou && !conferencia.nfe.passou
              ? ". Passou do limite da NFS-e: a janela da NFS-e não cria o rascunho até o texto ser encurtado."
              : ". Passou do limite: encurte o texto, senão a nota é recusada."
            : ""}
        </p>
      ) : null}
    </div>
  );
}
