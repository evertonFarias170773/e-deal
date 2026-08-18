-- Modalidade do frete no despacho: RETIRA, FOB ou CIF
--
-- O QUE E
--   Coluna aditiva que guarda a MODALIDADE comercial declarada pelo expedidor no
--   momento do despacho:
--     * RETIRA — o cliente busca no balcao;
--     * FOB    — transporte por conta do cliente;
--     * CIF    — transporte por conta do remetente.
--   Nullable, sem default: linha gravada antes desta migration fica nula.
--
-- POR QUE
--   `expedicoes.tipo_frete` responde "POR ONDE VAI" (CORREIOS, MOTOBOY,
--   TRANSPORTADORA, RETIRA_BALCAO...). Modalidade responde "QUEM PAGA". Sao
--   dimensoes ortogonais: um envio pode ser FOB via Braspress ou CIF via
--   Correios. O sistema so tinha a primeira, e por isso o modal de despacho
--   acabou oferecendo "Sem custo" como se fosse um tipo de frete.
--
--   Com a coluna, o despacho passa a pedir a modalidade primeiro e so entao abre
--   as transportadoras; em FOB os Correios ficam fora da lista, porque nao existe
--   servico dos Correios a cobrar do cliente — a pre-postagem sai pelo cartao de
--   postagem da empresa, que em FOB nao se aplica.
--
--   CIF ja entra no CHECK para nao exigir outra migration quando a fase de
--   recotacao chegar, mas NAO e oferecido na tela nesta fase: o modal so mostra
--   RETIRA e FOB.
--
-- ESCOPO / O QUE ESTA MIGRATION NAO FAZ
--   Estritamente aditiva. NAO altera `expedicoes_tipo_frete_check`, que continua
--   aceitando SEM_CUSTO: ha 98 cotacoes com o texto "Sem custo" em producao,
--   geradas continuamente pelo Orcamento (opcao "Retirada Local" para UF=RS), e o
--   painel precisa seguir exibindo, filtrando e agrupando esses pedidos.
--
--   Sem backfill, de proposito. Nao da para inferir a modalidade com seguranca a
--   partir do texto da cotacao — o proprio banco e o TypeScript ja divergem ao
--   ler "SEM CUSTO" (`osqr__forma_entrega` trata como indefinida;
--   `normalizarTipoFrete` trata como envio). A modalidade nasce quando o
--   expedidor a declara; ate la, nula.
--
--   Verificado em 18/08/2026: `public.expedicoes` tem 6 linhas (5 CORREIOS e 1
--   nula em tipo_frete), nenhuma com SEM_CUSTO. Nao ha dado a converter.

alter table public.expedicoes
  add column if not exists modalidade_frete text;

alter table public.expedicoes
  drop constraint if exists expedicoes_modalidade_frete_check;

alter table public.expedicoes
  add constraint expedicoes_modalidade_frete_check
  check (modalidade_frete is null or modalidade_frete in ('RETIRA', 'FOB', 'CIF'));

comment on column public.expedicoes.modalidade_frete is
  'Modalidade comercial do frete declarada no despacho: RETIRA (cliente busca no balcao), FOB (por conta do cliente) ou CIF (por conta do remetente). Ortogonal a tipo_frete, que diz por onde vai. CIF aceito no CHECK, mas ainda nao oferecido na tela. Nula nas linhas anteriores a 18/08/2026.';

-- VERIFICACAO (somente leitura, depois de aplicar)
--   select column_name, data_type, is_nullable
--     from information_schema.columns
--    where table_schema = 'public'
--      and table_name = 'expedicoes'
--      and column_name = 'modalidade_frete';
--
--   select conname, pg_get_constraintdef(oid)
--     from pg_constraint
--    where conrelid = 'public.expedicoes'::regclass
--      and conname in ('expedicoes_modalidade_frete_check', 'expedicoes_tipo_frete_check');
--
--   select coalesce(modalidade_frete, '(null)') as modalidade, count(*)
--     from public.expedicoes group by 1;
--
-- ROLLBACK
--   alter table public.expedicoes
--     drop constraint if exists expedicoes_modalidade_frete_check;
--   alter table public.expedicoes
--     drop column if exists modalidade_frete;
