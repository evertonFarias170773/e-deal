import { mostraSeletorDeTelefone, type AvaliacaoTelefone, type ChaveTelefone, type OpcaoTelefone } from "../lib/telefone-edicao";

/**
 * O telefone do destinatario no box de conferencia do despacho (21/10/2026; seletor em 22/10/2026).
 *
 * O cadastro pode ter ate tres telefones (WhatsApp 1, Telefone fixo comercial, WhatsApp 2) e o primeiro
 * costuma ser o errado. Com mais de um preenchido aparece um seletor: escolher um preenche o campo unico
 * abaixo, e e so esse que se edita. Quem tem `cadastros.edit` corrige; ao confirmar, se o numero final
 * for diferente do `whatsapp_1` do cadastro, ele e gravado la (`lib/telefone-edicao.ts`). Quem nao tem a
 * permissao ve o numero e o seletor bloqueado, e o despacho segue com o telefone cadastrado. Componente
 * de apresentacao: a decisao de gravar e de bloquear vem de `avaliarTelefoneEditado`.
 */
export function CampoTelefoneDestinatario({
  valor,
  onChange,
  podeEditar,
  avaliacao,
  nomeDestinatario,
  prepostagemJaGerada,
  opcoes = [],
  escolhida = null,
  onEscolher
}: {
  valor: string;
  onChange: (novo: string) => void;
  podeEditar: boolean;
  avaliacao: AvaliacaoTelefone;
  /** Cadastro que vai receber o numero (pagador ou cliente), para o expedidor saber onde grava. */
  nomeDestinatario: string;
  /** A prepostagem dos Correios ja foi gerada: ela guarda o telefone antigo e nao e alterada. */
  prepostagemJaGerada: boolean;
  /** Telefones preenchidos do cadastro. Menos de dois: sem seletor. */
  opcoes?: OpcaoTelefone[];
  escolhida?: ChaveTelefone | null;
  onEscolher?: (chave: ChaveTelefone) => void;
}) {
  const seletor = mostraSeletorDeTelefone(opcoes) ? (
    <label className="block">
      <span className="sr-only">Qual telefone do cadastro usar</span>
      <select
        value={escolhida ?? ""}
        disabled={!podeEditar}
        onChange={(e) => onEscolher?.(e.target.value as ChaveTelefone)}
        aria-label="Qual telefone do cadastro usar"
        className="mb-1 w-full rounded-xl border border-slate-300 bg-white px-2 py-1.5 text-xs font-medium text-slate-800 outline-none disabled:cursor-not-allowed disabled:opacity-70 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
      >
        {opcoes.map((o) => (
          <option key={o.chave} value={o.chave}>
            {o.rotulo}: {o.exibido}
            {o.defeito ? ` (${o.defeito})` : ""}
          </option>
        ))}
      </select>
    </label>
  ) : null;

  if (!podeEditar) {
    return (
      <div data-testid="telefone-somente-leitura">
        {seletor}
        <p className="text-base font-bold text-slate-900 dark:text-slate-100">{valor || "—"}</p>
        <p className="mt-1 text-[11px] text-slate-500">Sem permissão para corrigir o cadastro (cadastros.edit). O despacho usa o telefone cadastrado.</p>
      </div>
    );
  }
  return (
    <div data-testid="telefone-editavel" className="space-y-1">
      {seletor}
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
          Ao confirmar, este número é gravado no WhatsApp 1 do cadastro de {nomeDestinatario || "destinatário"} (os outros telefones não mudam).
        </p>
      ) : (
        <p className="text-[11px] text-slate-500">{seletor ? "Escolha acima o telefone certo ou corrija aqui o número." : "Corrija aqui o número, se estiver errado."}</p>
      )}
      {prepostagemJaGerada && avaliacao.alterado ? (
        <p className="text-[11px] text-slate-500">A prepostagem dos Correios já gerada mantém o telefone antigo.</p>
      ) : null}
    </div>
  );
}
