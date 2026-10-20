import type { AvaliacaoTelefone } from "../lib/telefone-edicao";

/**
 * O telefone do destinatario no box de conferencia do despacho (21/10/2026).
 *
 * Quem tem `cadastros.edit` corrige o numero aqui; ao confirmar, ele vai para o cadastro do
 * destinatario que o modal mostra (ver `lib/telefone-edicao.ts`). Quem nao tem a permissao ve o
 * numero do cadastro, sem editar, e o despacho segue normal com ele. Componente de apresentacao:
 * a decisao de gravar e de bloquear vem de `avaliarTelefoneEditado`.
 */
export function CampoTelefoneDestinatario({
  valor,
  onChange,
  podeEditar,
  avaliacao,
  nomeDestinatario,
  prepostagemJaGerada
}: {
  valor: string;
  onChange: (novo: string) => void;
  podeEditar: boolean;
  avaliacao: AvaliacaoTelefone;
  /** Cadastro que vai receber o numero (pagador ou cliente), para o expedidor saber onde grava. */
  nomeDestinatario: string;
  /** A prepostagem dos Correios ja foi gerada: ela guarda o telefone antigo e nao e alterada. */
  prepostagemJaGerada: boolean;
}) {
  if (!podeEditar) {
    return (
      <div data-testid="telefone-somente-leitura">
        <p className="text-base font-bold text-slate-900 dark:text-slate-100">{valor || "—"}</p>
        <p className="mt-1 text-[11px] text-slate-500">Sem permissão para corrigir o cadastro (cadastros.edit). O despacho usa o telefone cadastrado.</p>
      </div>
    );
  }
  return (
    <div data-testid="telefone-editavel" className="space-y-1">
      <input
        type="tel"
        inputMode="tel"
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Telefone do destinatário"
        aria-invalid={avaliacao.bloqueia}
        placeholder="(DDD) número"
        className={`w-full rounded-xl border bg-white px-3 py-2 text-base font-bold text-slate-900 outline-none dark:bg-slate-900 dark:text-slate-100 ${
          avaliacao.bloqueia ? "border-red-400 focus:border-red-500" : "border-slate-300 focus:border-[#0f9f9a] dark:border-slate-700"
        }`}
      />
      {avaliacao.erro ? (
        <p className="text-[11px] font-semibold text-red-600 dark:text-red-400" role="alert">
          Telefone inválido: {avaliacao.erro}. Informe só números, com DDD (mínimo 10 dígitos).
        </p>
      ) : avaliacao.gravar ? (
        <p className="text-[11px] font-medium text-amber-700 dark:text-amber-400">
          Ao confirmar, o número novo é gravado no cadastro de {nomeDestinatario || "destinatário"}.
        </p>
      ) : (
        <p className="text-[11px] text-slate-500">Corrija aqui se o número do cadastro estiver errado.</p>
      )}
      {prepostagemJaGerada && avaliacao.alterado ? (
        <p className="text-[11px] text-slate-500">A prepostagem dos Correios já gerada mantém o telefone antigo.</p>
      ) : null}
    </div>
  );
}
