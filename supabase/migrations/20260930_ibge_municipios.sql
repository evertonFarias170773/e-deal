-- ============================================================================
-- Tabela de municipios do IBGE — o codigo do municipio do destinatario na NF-e
-- ============================================================================
--
-- POR QUE
--   A NF-e sai so com o NOME da cidade (`municipio_destinatario`). Sem o codigo,
--   a Focus procura o municipio pelo nome e pela UF, e recusa com 422 qualquer
--   grafia fora da oficial:
--
--     NFE-22849-001  "Santana Do Livramento" / RS   (oficial: Sant'Ana do Livramento)
--     NFE-22596-001  "Poa" / RS                      (Porto Alegre)
--
--   Com esta tabela, `fn_montar_payload_nfe` passa a mandar tambem o
--   `codigo_municipio_destinatario` (migration 20260930_payload_nfe_codigo_municipio).
--
-- A FONTE
--   A lista oficial do IBGE, servicodados.ibge.gov.br/api/v1/localidades/municipios.
--   A carga e feita por scripts/fiscal/carregar-ibge-municipios.mjs, que confere
--   total, UFs e codigos antes de gravar. Esta migration so cria a estrutura.
--
-- A CHAVE DE BUSCA
--   `nome_chave` e o nome sem acento, sem maiuscula e so com [a-z0-9]: apostrofo,
--   espaco e hifen saem. "Sant'Ana do Livramento" e "Santana Do Livramento"
--   viram a mesma chave, `santanadolivramento`. O acento sai por uma lista
--   FECHADA (translate), e nao por unaccent, para a coluna poder ser gerada — e
--   para a funcao do payload usar exatamente a mesma expressao.
--
--   A chave e UNICA por UF: na lista de 30/09/2026 (5.571 municipios) nenhum
--   par de municipios da mesma UF difere so por acento, espaco ou apostrofo.
--
-- ACESSO
--   RLS ligada e SEM politica, e sem grant para anon e authenticated: quem le e
--   a `fn_montar_payload_nfe`, que e SECURITY DEFINER. O service_role (a carga)
--   ignora RLS.
--
-- ROLLBACK
--   drop table public.ibge_municipios;
--   (so depois de voltar a fn_montar_payload_nfe, que le esta tabela)
-- ============================================================================

create table if not exists public.ibge_municipios (
  codigo_ibge  text primary key,
  nome         text not null,
  uf           text not null,
  nome_chave   text generated always as (
                 regexp_replace(
                   lower(translate(nome,
                     'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑáàâãäéèêëíìîïóòôõöúùûüçñ',
                     'AAAAAEEEEIIIIOOOOOUUUUCNaaaaaeeeeiiiiooooouuuucn')),
                   '[^a-z0-9]', '', 'g')
               ) stored,
  carregado_em timestamptz not null default now(),
  constraint ibge_municipios_codigo_7_digitos check (codigo_ibge ~ '^[0-9]{7}$'),
  constraint ibge_municipios_uf_2_letras check (uf ~ '^[A-Z]{2}$'),
  constraint ibge_municipios_nome_preenchido check (btrim(nome) <> '')
);

create unique index if not exists ibge_municipios_uf_nome_chave
  on public.ibge_municipios (uf, nome_chave);

alter table public.ibge_municipios enable row level security;

revoke all on table public.ibge_municipios from public, anon, authenticated;

comment on table public.ibge_municipios is
  'Municipios do IBGE (lista oficial, servicodados.ibge.gov.br). Usada por fn_montar_payload_nfe para mandar codigo_municipio_destinatario na NF-e. Carga: scripts/fiscal/carregar-ibge-municipios.mjs. Criada em 30/09/2026.';
comment on column public.ibge_municipios.nome_chave is
  'Nome sem acento (lista fechada), minusculo, so [a-z0-9]. A fn_montar_payload_nfe aplica a MESMA expressao ao nome do endereco: mudar uma exige mudar a outra.';
