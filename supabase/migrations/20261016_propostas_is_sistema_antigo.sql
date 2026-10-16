-- =====================================================================================
-- PROPOSTAS: MARCA "PEDIDO DO SISTEMA ANTIGO" (is_sistema_antigo)
--
-- Autorizada nominalmente pelo Everton em 16/10/2026 (so esta migration).
--
-- O QUE E
--   ADD COLUMN public.propostas.is_sistema_antigo boolean, ACEITA NULO, SEM DEFAULT.
--     NULL  = pedido anterior a esta mudanca, nao classificado (nao presumir "novo")
--     false = pedido 100% Vibe
--     true  = pedido que veio do sistema antigo (a OS Ideal e exigida na tela)
--   Quem grava e o modal "Criar cobranca" (PropostaCobrancaPanel), so quando o valor muda
--   e nunca em proposta avulsa com valor_total vazio ou zero: o gatilho
--   tg_propostas_valor_total_avulsa preenche valor_total em qualquer UPDATE dessas linhas.
--   A OS Ideal continua em pagamentos_v2.os_ideal.
--
-- O QUE NAO FAZ
--   Sem backfill (todas as propostas existentes ficam NULL), sem GRANT/REVOKE, sem RLS,
--   sem gatilho, sem tocar em pagamentos_v2, boletos ou n8n.
--   ADD COLUMN sem default nao reescreve a tabela e nao dispara gatilho de UPDATE: valor_total,
--   valor_frete e status_interno nao mudam. As visoes que usam p.* (vw_propostas_lista)
--   continuam com as colunas de quando foram criadas.
--
-- GUARDA
--   Aborta se a coluna ja existir. Depois do ADD, confere tipo boolean, nulo permitido,
--   sem default e nenhuma linha preenchida.
--
-- ROLLBACK (no rodape)
-- =====================================================================================

do $guarda$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'propostas' and column_name = 'is_sistema_antigo') then
    raise exception 'GUARDA: propostas.is_sistema_antigo ja existe';
  end if;
end;
$guarda$;

alter table public.propostas add column is_sistema_antigo boolean;

comment on column public.propostas.is_sistema_antigo is
  'Pedido veio do sistema antigo (exige OS Ideal na cobranca). NULL = anterior a 16/10/2026, nao classificado; false = 100% Vibe; true = sistema antigo. Gravada pelo modal Criar cobranca.';

do $verifica$
declare
  c record;
begin
  select data_type, is_nullable, column_default into c
    from information_schema.columns
   where table_schema = 'public' and table_name = 'propostas' and column_name = 'is_sistema_antigo';
  if c.data_type is distinct from 'boolean' or c.is_nullable <> 'YES' or c.column_default is not null then
    raise exception 'VERIFICA: coluna fora do esperado (tipo %, nulo %, default %)', c.data_type, c.is_nullable, c.column_default;
  end if;
  if exists (select 1 from public.propostas where is_sistema_antigo is not null) then
    raise exception 'VERIFICA: alguma proposta ja tem is_sistema_antigo preenchido';
  end if;
end;
$verifica$;

-- =====================================================================================
-- ROLLBACK
--   alter table public.propostas drop column if exists is_sistema_antigo;
--   (apaga as marcas gravadas depois da aplicacao; antes, conferir quantas existem)
-- =====================================================================================
