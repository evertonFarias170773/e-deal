-- valor_total de proposta AVULSA: preenchimento automatico + backfill
--
-- ESCOPO (leia antes de mexer)
--   Isto NAO e um recalculo de proposta. E uma PROTECAO CONTRA valor_total
--   ausente em proposta AVULSA, e so.
--   * Age exclusivamente em proposta AVULSA (`is_avulso = true`).
--   * Age quando `valor_total` esta NULL, ou quando esta 0 com `valor` > 0.
--   * NAO reage a alteracao de itens, desconto, frete ou bonus. Editar
--     produtos_proposta depois NAO refaz este calculo — nem deve.
--   * NAO toca proposta nao avulsa, com ou sem itens.
--   * NAO toca `status_interno` em nenhuma hipotese.
--
--   A AUTORIDADE sobre `valor_total` continua sendo a aplicacao (`saveProposta`,
--   em src/features/orcamentos/services/orcamentos.service.ts). Ela conhece
--   regras comerciais que o banco nao conhece — bonus/tabela especial do
--   cliente, desconto por item — e por isso qualquer valor explicito MAIOR QUE
--   ZERO e preservado. Medido em producao: a proposta #20144 tem 129,16 gravado
--   contra 142,36 que a formula SQL calcularia. Sobrescrever corromperia o
--   valor comercial.
--
-- PROBLEMA QUE MOTIVOU
--   `recalcular_proposta_v4(p_id_int)` e RETURNS TABLE: apenas CALCULA e
--   devolve. O trigger `tg_recalc_propostas_v4` fazia
--   `PERFORM recalcular_proposta_v4(...)` e `RETURN NULL`, DESCARTANDO o
--   resultado sem nenhum UPDATE — um no-op. `propostas.valor_total` so era
--   gravado pela aplicacao; avulsa criada/paga fora desse caminho ficava NULL,
--   e a engine de status (que exige total > 0, guarda proposital) nunca
--   promovia a proposta mesmo com pagamento confirmado (caso #18792).
--
-- REGRA DA AVULSA
--   `coalesce(valor, 0) + coalesce(valor_frete, 0)` — frete ausente conta 0.
--   E a regra oficial do projeto, ja usada no fallback
--   `valor_total ?? (valor + valor_frete)` de orcamentos.service.ts. Avulsa nao
--   tem itens em produtos_proposta, por isso `recalcular_proposta_v4` devolve
--   zero para ela e nao serve neste caso (medido: diverge em 33 de 33 avulsas
--   recentes). A formula bate em 950 de 953 avulsas ja gravadas em producao.
--
-- RISCO DE RECURSAO: NENHUM
--   Trigger BEFORE que escreve apenas em NEW (atribuicao em memoria, antes de a
--   linha ser gravada). Nao ha `UPDATE public.propostas` dentro dele — esse era
--   o unico caminho de reentrada, e e o motivo de ser BEFORE e nao AFTER.
--
--   Ordem entre triggers BEFORE de public.propostas (alfabetica):
--     propostas_set_timestamp -> tg_recalc_propostas_v4 -> tg_registrar_paid_at
--     -> trg_set_updated_at
--   Nenhum dos outros le ou escreve `valor_total`, entao a ordem e indiferente.
--
-- Aditivo e reversivel no schema: substitui a funcao do trigger e recria o
-- trigger. Nao altera schema, RLS nem permissoes.
-- `recalcular_proposta_v4` permanece INTACTA e deixa de ser usada por este
-- trigger (outros consumidores seguem iguais).

-- ---------------------------------------------------------------------------
-- 1. Funcao do trigger
-- ---------------------------------------------------------------------------

create or replace function public.recalcular_proposta_v4_trigger()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_calculado numeric;
begin
  -- Proposta NAO avulsa: nao preenche nada, nem quando esta sem itens.
  -- No INSERT os itens ainda nem existem (sao gravados depois) e qualquer
  -- numero aqui seria enganoso. Deixando como esta, o saveProposta grava o
  -- valor correto em seguida — ele e a autoridade.
  if not coalesce(new.is_avulso, false) then
    return new;
  end if;

  -- Valor explicito valido (> 0) manda. Nunca sobrescreve.
  if new.valor_total is not null and new.valor_total > 0 then
    return new;
  end if;

  -- Restam os casos a corrigir: valor_total NULL, ou 0 com valor positivo.
  v_calculado := coalesce(new.valor, 0) + coalesce(new.valor_frete, 0);

  if new.valor_total is null then
    new.valor_total := v_calculado;
  elsif new.valor_total = 0 and coalesce(new.valor, 0) > 0 then
    new.valor_total := v_calculado;
  end if;

  return new;
end;
$function$;

comment on function public.recalcular_proposta_v4_trigger() is
  'Protecao contra valor_total ausente (nao e recalculo). Age SOMENTE em proposta avulsa: preenche quando nulo, ou quando zero com valor > 0, usando valor + valor_frete. Valor explicito maior que zero e sempre preservado: saveProposta e a autoridade. Nao reage a alteracao de itens. BEFORE trigger, sem UPDATE interno — sem recursao.';

-- ---------------------------------------------------------------------------
-- 2. Trigger (BEFORE, para atribuir NEW sem executar UPDATE)
-- ---------------------------------------------------------------------------

drop trigger if exists tg_recalc_propostas_v4 on public.propostas;

create trigger tg_recalc_propostas_v4
  before insert or update on public.propostas
  for each row
  execute function public.recalcular_proposta_v4_trigger();

-- ---------------------------------------------------------------------------
-- 3. Passivo existente — NAO tratado aqui
-- ---------------------------------------------------------------------------
-- Esta migration e PREVENTIVA: garante que nenhuma avulsa NOVA nasca ou seja
-- salva sem valor_total. Ela NAO corrige as propostas ja gravadas — o trigger
-- so age quando a linha e inserida ou atualizada.
--
-- Passivo medido em producao em 2026-08-04:
--   5.365 avulsas com valor_total NULL e valor > 0
--     209 avulsas com valor_total NULL e valor = 0  (fora do escopo da correcao)
--       0 avulsas com valor_total = 0
--
-- A correcao desse passivo sai em MIGRATION SEPARADA, deliberadamente fora
-- desta, por dois motivos:
--   1. Um UPDATE em massa dispara `propostas_set_timestamp` e `trg_set_updated_at`,
--      que reescrevem `updated_at` e jogariam milhares de propostas antigas para
--      o topo da ordenacao por ultima atualizacao na listagem de Orcamentos.
--      O backfill precisa preservar o `updated_at` original, o que exige
--      desabilitar esses dois triggers durante a execucao — operacao que pede
--      janela e acompanhamento, nao pode viajar junto de uma migration de schema.
--   2. Separar mantem esta migration reversivel e sem efeito sobre dados.
--
-- Ate la, `status_interno` das propostas do passivo permanece como esta:
-- a engine de status nao promove proposta com total zero, por guarda proposital.
