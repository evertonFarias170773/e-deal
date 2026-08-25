-- NORMALIZACAO DE public.clientes — tipo_contribuinte e nota — 25/08/2026
--
-- ESTE ARQUIVO NAO E UMA MIGRATION E NAO FOI EXECUTADO PELO AGENTE.
-- E o script que o DONO aplica a mao no Supabase, e o registro do que foi feito.
-- Rode bloco a bloco, conferindo as contagens ANTES e DEPOIS de cada UPDATE.
--
-- ============================================================================
-- AVISO 1 — O CUSTO DOS DOIS UPDATE
-- ============================================================================
-- Os dois UPDATE juntos reescrevem ~131.790 linhas de public.clientes
-- (65.868 no tipo_contribuinte + 65.922 no nota), sobre uma tabela de 65.929.
-- Na pratica: a tabela inteira, duas vezes.
--
-- public.clientes NAO TEM coluna `updated_at` — conferido no
-- information_schema em 25/08/2026. Entao NAO existe carimbo de data por linha
-- para ser reescrito, e nenhuma tela reordena por causa disso: as listagens de
-- cadastro ordenam por `id_cliente` (cadastros.service.ts), nao por data de
-- alteracao. `data_criacao` e `data_cadastro` tambem nao sao tocadas.
--
-- O QUE DE FATO E RECARIMBADO e a AUDITORIA. A tabela tem
-- `trg_audit_clientes` (audit.log_row_changes_v2) disparando FOR EACH ROW em
-- UPDATE, e a auditoria de `clientes` esta ATIVA (audit.config_v2.enabled =
-- true). Cada linha efetivamente alterada grava um registro em audit.logs_v2
-- com o old_data e o new_data COMPLETOS do cadastro em jsonb.
--
--   audit.logs_v2 hoje:            196.113 registros
--   audit.logs_v2 de `clientes`:   132.286 registros
--   depois destes dois UPDATE:    ~327.900 registros (+~131.790)
--
-- Ou seja: esta operacao MAIS QUE DOBRA o volume de auditoria de `clientes`,
-- num unico instante, com dois `occurred_at` praticamente iguais. Quem for
-- investigar o historico de um cadastro depois disso vai atravessar essa
-- camada — os dois lotes ficam identificaveis pelo `occurred_at` e por
-- `changed_fields` conter so `tipo_contribuinte` ou so `nota`.
--
-- O trigger PULA linha sem mudanca efetiva (`if v_old = v_new then return
-- new`), e os WHERE abaixo ja excluem quem esta no valor final. As duas coisas
-- somadas evitam auditoria inutil.
--
-- ============================================================================
-- AVISO 2 — ORDEM FISICA
-- ============================================================================
-- UPDATE em Postgres reescreve a linha em nova posicao no heap. Depois disto,
-- QUALQUER consulta a clientes SEM `ORDER BY` explicito volta numa ordem
-- diferente da de hoje. Nada no app depende disso (as listagens ordenam por
-- `id_cliente`), mas exportacoes ou consultas manuais sem ORDER BY vao parecer
-- embaralhadas. Um VACUUM (ANALYZE) depois e recomendado.
--
-- ============================================================================
-- AVISO 3 — O QUE NAO ESTA AQUI
-- ============================================================================
--   - notas ja emitidas e rascunhos existentes: INTOCADOS. `notas_fiscais`
--     nao aparece neste script.
--   - `consumidor_final`: intocado, ja marca 1 para CPF corretamente.
--   - `fn_montar_payload_nfe` e o coalesce dela: intocados.
--   - `propostas.libera_nf`: intocado.
--
-- ============================================================================


-- ============================================================================
-- BLOCO 1 — tipo_contribuinte: texto livre vira codigo da SEFAZ
-- ============================================================================
--
-- A COLUNA: public.clientes.tipo_contribuinte, text, DEFAULT ''::text, nulavel.
-- Continua text e continua sem CHECK — este script normaliza o CONTEUDO, nao
-- muda o tipo. (Um CHECK depois exigiria decidir o que fazer com escrita
-- externa; fica fora desta rodada.)
--
-- A TRADUCAO, na MESMA ordem de src/lib/fiscal/tipo-contribuinte.ts. A ordem
-- importa: "Nao Contribuinte" contem "CONTRIBUINTE", e
-- "2 = Contribuinte isento de inscricao estadual" contem "CONTRIBUINTE ISENTO".
-- Do mais especifico para o mais generico:
--
--   ja e '1' | '2' | '9'          -> mantem
--   contem 'NAO CONTRIBUINTE'     -> '9'
--   contem 'CONTRIBUINTE ISENTO'  -> '2'
--   contem 'CONTRIBUINTE ICMS'    -> '1'
--   texto exato 'CONTRIBUINTE'    -> '1'
--   texto exato 'ISENTO'          -> '9'
--   vazio / NULL / nao reconhecido-> '9'
--
-- POR QUE 'ISENTO' VAI PARA 9 E NAO PARA 2: no cadastro antigo "Isento" sempre
-- significou "sem inscricao estadual", nao "contribuinte isento de IE". Sao
-- 64.748 das 65.929 linhas — a esmagadora maioria pessoa fisica e PJ nao
-- contribuinte. Mandar tudo para 2 declararia contribuinte de ICMS quem nao e,
-- que e justamente o erro que rende rejeicao na SEFAZ.

-- 1.1 ANTES — foto do estado atual (esperado em 25/08/2026):
--     ISENTO 64.748 | '' 854 | NULL 212 | 2 59 | '2 = Contribuinte isento' 33 |
--     CONTRIBUINTE 11 | 'Não Contribuinte' 6 | 1 2 | '9 = Não contribuinte' 2 |
--     '2 = Contribuinte isento de inscrição estadual' 1 | '1 = Contribuinte ICMS' 1
select
  coalesce(tipo_contribuinte, '<NULL>') as valor,
  count(*) as linhas
from public.clientes
group by 1
order by 2 desc;

-- 1.2 PREVIA — quantas linhas cada codigo vai receber, SEM escrever nada.
--     Rode e confira antes do UPDATE. Conferido em 25/08/2026 na base real:
--     1 -> 14 linhas | 2 -> 93 linhas | 9 -> 65.822 linhas (total 65.929).
--
--     O `translate` faz o papel do "sem acento": a extensao `unaccent` NAO
--     esta instalada neste projeto, e este script nao instala extensao. E o
--     mesmo achatamento que src/lib/fiscal/tipo-contribuinte.ts faz com
--     normalize("NFD").
with traduzido as (
  select
    case
      when upper(trim(coalesce(tipo_contribuinte, ''))) in ('1','2','9')
        then upper(trim(tipo_contribuinte))
      when upper(translate(coalesce(tipo_contribuinte, ''),
             'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
             'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'))
           like '%NAO CONTRIBUINTE%' then '9'
      when upper(translate(coalesce(tipo_contribuinte, ''),
             'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
             'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'))
           like '%CONTRIBUINTE ISENTO%' then '2'
      when upper(translate(coalesce(tipo_contribuinte, ''),
             'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
             'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'))
           like '%CONTRIBUINTE ICMS%' then '1'
      when upper(trim(coalesce(tipo_contribuinte, ''))) = 'CONTRIBUINTE' then '1'
      when upper(trim(coalesce(tipo_contribuinte, ''))) = 'ISENTO'       then '9'
      else '9'
    end as codigo
  from public.clientes
)
select codigo, count(*) as linhas from traduzido group by 1 order by 1;

-- 1.3 O UPDATE.
--     O WHERE final pula quem ja esta em '1'/'2'/'9' — sem ele, 61 linhas
--     seriam reescritas para o proprio valor (o trigger de auditoria as
--     ignoraria, mas a escrita aconteceria assim mesmo).
update public.clientes
set tipo_contribuinte =
  case
    when upper(translate(coalesce(tipo_contribuinte, ''),
           'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
           'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'))
         like '%NAO CONTRIBUINTE%' then '9'
    when upper(translate(coalesce(tipo_contribuinte, ''),
           'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
           'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'))
         like '%CONTRIBUINTE ISENTO%' then '2'
    when upper(translate(coalesce(tipo_contribuinte, ''),
           'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
           'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'))
         like '%CONTRIBUINTE ICMS%' then '1'
    when upper(trim(coalesce(tipo_contribuinte, ''))) = 'CONTRIBUINTE' then '1'
    when upper(trim(coalesce(tipo_contribuinte, ''))) = 'ISENTO'       then '9'
    else '9'
  end
where tipo_contribuinte is null
   or upper(trim(tipo_contribuinte)) not in ('1', '2', '9');

-- 1.4 DEPOIS — so pode sobrar 1, 2 e 9. Qualquer outra linha aqui e bug.
select
  coalesce(tipo_contribuinte, '<NULL>') as valor,
  count(*) as linhas
from public.clientes
group by 1
order by 2 desc;


-- ============================================================================
-- BLOCO 2 — nota: passa a nascer true e todos os cadastros atuais viram true
-- ============================================================================
--
-- A COLUNA: public.clientes.nota, boolean, DEFAULT false, nulavel.
-- Hoje: 65.922 false, 7 true, 0 null.
--
-- O QUE ELA PASSA A SIGNIFICAR: se o PEDIDO daquele cliente entra na Fila de
-- Faturamento. `false` tira o pedido da fila. Ate agora a coluna nao era lida
-- por ninguem — era carregada e regravada pelo formulario e mais nada — e por
-- isso o `false` de 65.922 cadastros nunca significou coisa alguma.
--
-- POR QUE TODOS VIRAM TRUE: porque o estado atual e acidental, nao uma decisao.
-- Se a regra nova entrasse com o `false` de hoje, a Fila de Faturamento
-- ZERARIA — as 24 propostas com `libera_nf = true` sairiam todas (medido em
-- 25/08/2026: 24 na fila, 0 com cliente marcado true). Daqui em diante so o
-- Financeiro desmarca, um a um, pelo botao "Nota" no cadastro.

-- 2.1 ANTES — esperado: false 65.922 | true 7 | null 0
select coalesce(nota::text, '<NULL>') as valor, count(*) as linhas
from public.clientes
group by 1
order by 2 desc;

-- 2.2 DEFAULT: cadastro novo nasce faturavel.
--     So muda o padrao de INSERT futuro; nao toca em nenhuma linha existente.
alter table public.clientes
  alter column nota set default true;

-- 2.3 O UPDATE. O `is distinct from true` pega false E null e pula os 7 que ja
--     estao true.
update public.clientes
set nota = true
where nota is distinct from true;

-- 2.4 DEPOIS — esperado: true 65.929, e nada mais.
select coalesce(nota::text, '<NULL>') as valor, count(*) as linhas
from public.clientes
group by 1
order by 2 desc;


-- ============================================================================
-- BLOCO 3 — conferencia final
-- ============================================================================

-- 3.1 A Fila de Faturamento depois da normalizacao: nenhuma proposta pode sair
--     pela regra do `nota`. `saem_por_nota_false` tem de voltar 0.
select
  count(*)                                          as propostas_na_fila,
  count(*) filter (where cl.nota is true)            as ficam,
  count(*) filter (where cl.nota is false)           as saem_por_nota_false,
  count(*) filter (where cl.id_cliente is null)      as sem_cadastro_encontrado
from public.propostas p
left join public.clientes cl on cl.id_cliente = p.id_cliente
where p.libera_nf = true;

-- 3.2 Peso da auditoria depois da operacao — so para saber o tamanho do rastro.
select count(*) as logs_de_clientes
from audit.logs_v2
where table_name = 'clientes';

-- 3.3 Recomendado depois dos dois UPDATE.
-- vacuum (analyze) public.clientes;


-- ============================================================================
-- ROLLBACK
-- ============================================================================
-- NAO HA rollback automatico do BLOCO 1: a traducao perde informacao de
-- proposito (11 grafias viram 3 codigos, e nao da para saber se um `9` era
-- `ISENTO` ou vazio). O estado anterior de cada linha esta preservado em
-- audit.logs_v2 (old_data completo, changed_fields = tipo_contribuinte), que e
-- de onde uma reversao teria de sair, cadastro a cadastro.
--
-- BLOCO 2, se precisar desfazer:
--   alter table public.clientes alter column nota set default false;
--   -- e, para os cadastros, o mesmo caminho: audit.logs_v2.
