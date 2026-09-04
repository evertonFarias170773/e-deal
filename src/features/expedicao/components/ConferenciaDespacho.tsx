"use client";

import type { EtiquetaViewModel } from "../services/etiqueta-viewmodel.service";
import { apresentacaoEtiqueta } from "../lib/etiqueta-apresentacao";

/**
 * BOX DE CONFERENCIA DO DESPACHO (04/09/2026).
 *
 * O QUE E
 *   Os dados do envio reunidos num bloco de leitura, para o expedidor conferir
 *   antes de despachar: para quem vai, para onde, por onde e com que recado.
 *
 * O QUE NAO E
 *   NAO e a etiqueta. Ate esta data o modal exibia uma PREVIA que imitava o
 *   papel — moldura 10x15, reguas, QR, corpo grande — e a direcao pediu o
 *   contrario: um resumo, sem simular o impresso. Vale para os TRES fluxos
 *   (10x15, Correios e Retira), porque o que se confere e o despacho, nao o
 *   documento que vai sair.
 *
 * TIPOGRAFIA: LEITURA DE LONGE, COM O VOLUME NA MAO (04/09/2026)
 *   Os VALORES sao grandes e os ROTULOS continuam pequenos — quem confere ja
 *   sabe o que cada linha e, e precisa bater o conteudo, nao o titulo. A
 *   hierarquia segue a ordem em que o erro custa caro: o NOME e o maior texto
 *   do box, depois endereco, bairro, CEP e cidade/UF; forma de envio e
 *   observacoes vem em corpo intermediario.
 *
 * A LOGICA NAO MUDOU, so o desenho. Os dados vem do MESMO
 * `montarEtiquetaViewModel` que o PDF usa, servido pela rota
 * `/api/expedicao/etiqueta/previa`, e as linhas derivadas (cidade/UF, corte da
 * observacao, linha do telefone, "A DEFINIR", "—") continuam saindo de
 * `lib/etiqueta-apresentacao.ts`. Tela e papel dizem o mesmo porque leem o
 * mesmo.
 */

const rotulo = "text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400";
/** Nome do destinatario: o MAIOR texto do box. Quebra em telas estreitas. */
const nomeDestinatario =
  "text-xl sm:text-2xl font-bold leading-tight text-slate-900 break-words dark:text-slate-100";
/** Endereco, bairro, CEP e cidade/UF — o bloco "para onde vai". */
const destaque = "text-base sm:text-lg font-semibold leading-snug text-slate-900 break-words dark:text-slate-100";
/** Forma de envio e observacoes: corpo intermediario. */
const medio = "text-sm sm:text-base leading-snug text-slate-800 break-words dark:text-slate-200";

export function ConferenciaDespacho({
  vm,
  objetoCorreios
}: {
  vm: EtiquetaViewModel;
  /**
   * Codigo do objeto (ou id da prepostagem) que JA existe nos Correios; `null`
   * quando nao ha, ou quando o envio nao vai por eles. Governa o unico aviso
   * que sobrou aqui — o de congelamento, que informa consequencia
   * irreversivel, nao orienta o uso da tela.
   */
  objetoCorreios: string | null;
}) {
  const a = apresentacaoEtiqueta(vm);

  return (
    <section
      aria-label={`Conferência do despacho do pedido ${vm.idInt}`}
      className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/60"
    >
      {objetoCorreios ? (
        <p className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          Prepostagem já gerada ({objetoCorreios}): nome, endereço e telefone do destinatário já foram transmitidos e
          congelaram do lado dos Correios. Alterar aqui não muda o rótulo oficial — para corrigir, gere outra
          prepostagem.
        </p>
      ) : null}

      <div className="space-y-3">
        <div>
          <p className={rotulo}>Destinatário</p>
          <p className={nomeDestinatario}>{vm.destinatario.nome}</p>
          {vm.destinatario.recebedor ? <p className={medio}>A/C: {vm.destinatario.recebedor}</p> : null}
        </div>

        <div>
          <p className={rotulo}>Endereço</p>
          <p className={destaque}>{vm.destinatario.endereco || "—"}</p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <p className={rotulo}>Bairro</p>
            <p className={destaque}>{vm.destinatario.bairro || "—"}</p>
          </div>
          <div>
            <p className={rotulo}>Fone</p>
            {/* `telefoneLinha` ja vem com o prefixo "Fone: " para o papel; aqui
                o rotulo ja diz isso, entao sai so o numero. */}
            <p className={destaque}>{vm.destinatario.telefone || "—"}</p>
          </div>
          <div>
            <p className={rotulo}>CEP</p>
            <p className={destaque}>{a.cepExibido}</p>
          </div>
          <div>
            <p className={rotulo}>Cidade/UF</p>
            <p className={destaque}>{a.cidadeUfLinha}</p>
          </div>
        </div>

        <div>
          {/* FORMA DE ENVIO E LEITURA (04/09/2026): a transportadora vale a que
              a proposta define, e o expedidor nao a troca mais aqui. O valor sai
              do view model, com a mesma precedencia do papel — despacho
              confirmado manda, senao o vinculo do orcamento. */}
          <p className={rotulo}>Forma de envio</p>
          <p className={medio}>
            <span className="font-semibold">{a.transportadoraExibida}</span>
          </p>
        </div>

        <div>
          <p className={rotulo}>Observações</p>
          <p className={medio}>{a.observacaoImpressa || "—"}</p>
        </div>
      </div>
    </section>
  );
}
