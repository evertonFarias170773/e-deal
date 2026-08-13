-- pedidos_artes.status_producao — fase de producao POR SETOR
--
-- O QUE E
--   A fase de producao do boletim de UM setor (PVC, LASER, FLEXO, TEXTIL).
--   Cada linha de pedidos_artes ja e o boletim de um setor do pedido
--   (pedidos_artes.setor), entao a fase mora na propria linha do setor.
--
-- POR QUE
--   Ate aqui a producao inteira tinha UM status so: propostas.status_interno.
--   Um pedido com 4 setores (ex.: id_int 20508 = LASER, PVC, FLEXO, TEXTIL)
--   disputava esse unico campo — quem movesse o FLEXO reescrevia o status que o
--   TEXTIL tinha acabado de gravar. Nao havia como a lista de OS mostrar
--   "FLEXO em impressao, PVC em acabamento", porque o dado nao existia.
--
-- VOCABULARIO (mesmo do QR de producao, public.osqr__status_qr())
--   EM PRODUCAO
--   EM IMPRESSAO            <-> EM IMPRESSAO / PENDENTE
--   EM ACABAMENTO           <-> EM ACABAMENTO / PENDENTE
--   CONCLUIDO               (setor terminou; e o unico valor novo)
--
--   A perna de EXPEDICAO em diante (EXPEDICAO, A RETIRAR, EM TRANSITO,
--   ENTREGUE) NAO entra aqui: expedicao e do pedido inteiro, nao de um setor —
--   e o mesmo corte que a pagina do boletim ja faz (abas de setor + aba
--   Expedicao global).
--
-- RELACAO COM propostas.status_interno
--   status_interno continua sendo o status do PEDIDO e nao muda de dono. A
--   aplicacao o espelha no setor MENOS avancado enquanto houver setor em aberto,
--   e nunca escreve nele CONCLUIDO nem promove para EXPEDICAO — a saida da
--   producao segue pelo caminho existente.
--
-- NULL
--   Boletim sem fase gravada le como EM PRODUCAO (derivado, nao escrito). Por
--   isso a coluna nasce nula em todas as linhas e nada e retroativo.
--
-- ADITIVA E INERTE
--   Enquanto ninguem gravar, o comportamento e bit a bit o de hoje. Rollback:
--     alter table public.pedidos_artes
--       drop constraint if exists pedidos_artes_status_producao_check,
--       drop column if exists status_producao_em,
--       drop column if exists status_producao;
--
-- ANTES DE APLICAR — verificacao (somente leitura)
--
--     select id_int, count(*) as boletins,
--            string_agg(coalesce(setor, '(null)'), ' | ' order by created_at) as setores
--     from public.pedidos_artes group by id_int order by id_int desc limit 10;
--
-- DEPOIS DE APLICAR
--
--     select column_name, data_type, is_nullable
--     from information_schema.columns
--     where table_schema = 'public' and table_name = 'pedidos_artes'
--       and column_name in ('status_producao', 'status_producao_em');

alter table public.pedidos_artes
  add column if not exists status_producao text,
  add column if not exists status_producao_em timestamptz;

alter table public.pedidos_artes
  drop constraint if exists pedidos_artes_status_producao_check;

alter table public.pedidos_artes
  add constraint pedidos_artes_status_producao_check
  check (
    status_producao is null
    or status_producao in (
      'EM PRODUCAO',
      'EM IMPRESSAO',
      'EM IMPRESSAO / PENDENTE',
      'EM ACABAMENTO',
      'EM ACABAMENTO / PENDENTE',
      'CONCLUIDO'
    )
  );

comment on column public.pedidos_artes.status_producao is
  'Fase de producao do boletim DESTE setor (pedidos_artes.setor). Vocabulario de public.osqr__status_qr() ate EM ACABAMENTO, mais CONCLUIDO. NULL le como EM PRODUCAO. Expedicao e do pedido, nao do setor, e nao entra aqui.';

comment on column public.pedidos_artes.status_producao_em is
  'Quando status_producao mudou pela ultima vez.';
