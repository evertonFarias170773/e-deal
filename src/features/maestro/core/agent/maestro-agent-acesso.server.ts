/**
 * maestro-agent-acesso.server.ts
 *
 * Quem esta perguntando e o que essa pessoa pode ver — resolvido no SERVIDOR,
 * uma vez por consulta, a partir de public.usuarios e public.perfis.
 *
 * Duas regras moram aqui, e as duas imitam o que as telas ja fazem:
 *
 * 1. PERMISSAO DE TELA (`podeNaTela`): a mesma conta do PermissionGuard —
 *    super admin, administrador ou a chave no perfil. "Administrador" e o que a
 *    tela chama de admin: perfil com `admin.usuarios.view` (ou a coluna legada
 *    `is_admin` quando o usuario nao tem perfil). Usada pelas consultas por
 *    pedido: cada parte exige a permissao da tela onde aquele dado aparece.
 *
 * 2. ESCOPO POR VENDEDOR (`escopoDePedidos`): decisao do dono em 01/10/2026 —
 *    vendedor ve so os proprios pedidos, salvo quem tem visao geral
 *    (`propostas.view_all` ou curinga). A trava fica AQUI porque a RLS de
 *    public.propostas e aberta para qualquer usuario logado.
 *
 * ⚠️ Roda apenas no servidor.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { rotuloDaPermissao } from '../../../usuarios-perfis/catalogo-permissoes';

export interface AcessoUsuario {
  encontrado: boolean;
  /** usuarios.nome_usuario */
  nome: string | null;
  /** usuarios.meu_vendedor || nome_usuario — e o texto que casa com propostas.vendedor */
  nomeComercial: string | null;
  perfilNome: string | null;
  /** Chaves do perfil ativo (vazio quando nao ha perfil) */
  permissoes: ReadonlySet<string>;
  /** Perfil com o curinga "*" ou coluna is_super_adm */
  superAdmin: boolean;
  /** O "administrador" das telas (ver cabecalho) */
  admin: boolean;
  /** Atende como vendedor: is_vendedor, meu_vendedor preenchido ou perfil de escopo proprio */
  ehVendedor: boolean;
}

const SEM_ACESSO: AcessoUsuario = {
  encontrado: false,
  nome: null,
  nomeComercial: null,
  perfilNome: null,
  permissoes: new Set<string>(),
  superAdmin: false,
  admin: false,
  ehVendedor: false,
};

function texto(valor: unknown): string | null {
  return typeof valor === 'string' && valor.trim() ? valor.trim() : null;
}

/** Le usuario + perfil com o client recebido (sessao de quem pergunta). Nunca lanca. */
export async function carregarAcessoUsuario(supabase: SupabaseClient, userId: string): Promise<AcessoUsuario> {
  try {
    const { data: usuario } = await supabase
      .from('usuarios')
      .select('id_perfil, is_super_adm, is_admin, is_vendedor, nome_usuario, meu_vendedor')
      .eq('user_id', userId)
      .maybeSingle();
    if (!usuario) return SEM_ACESSO;

    const row = usuario as Record<string, unknown>;
    let permissoes: string[] = [];
    let perfilNome: string | null = null;
    let temPerfil = false;

    if (row.id_perfil != null) {
      const { data: perfil } = await supabase
        .from('perfis')
        .select('nome, permissoes')
        .eq('id', row.id_perfil)
        .eq('ativo', true)
        .maybeSingle();
      if (perfil) {
        const p = perfil as Record<string, unknown>;
        temPerfil = true;
        perfilNome = texto(p.nome);
        permissoes = Array.isArray(p.permissoes) ? p.permissoes.map(String) : [];
      }
    }

    const conjunto = new Set(permissoes);
    const superAdmin = row.is_super_adm === true || conjunto.has('*');
    // Mesma conta do front (usuarios.service.ts): com perfil resolvido, admin e
    // quem tem admin.usuarios.view; sem perfil, vale a coluna legada.
    const admin = superAdmin || (temPerfil ? conjunto.has('admin.usuarios.view') : row.is_admin === true);
    const nome = texto(row.nome_usuario);
    const meuVendedor = texto(row.meu_vendedor);

    return {
      encontrado: true,
      nome,
      nomeComercial: meuVendedor ?? nome,
      perfilNome,
      permissoes: conjunto,
      superAdmin,
      admin,
      ehVendedor: row.is_vendedor === true || meuVendedor !== null || conjunto.has('propostas.view_own'),
    };
  } catch (err) {
    // Falha na leitura NUNCA vira acesso.
    console.error('[MaestroAcesso] Erro ao carregar o acesso do usuario:', err);
    return SEM_ACESSO;
  }
}

/** Regra das telas: super admin, administrador ou QUALQUER uma das chaves. */
export function podeNaTela(acesso: AcessoUsuario, chaves: readonly string[]): boolean {
  if (!acesso.encontrado) return false;
  if (acesso.superAdmin || acesso.admin) return true;
  return chaves.some(chave => acesso.permissoes.has(chave));
}

export type EscopoDePedidos = 'todos' | 'proprios' | 'pela_tela';

/**
 * - `todos`: visao geral (super admin, curinga ou propostas.view_all).
 * - `proprios`: vendedor sem visao geral — so o pedido em que ele e o vendedor.
 * - `pela_tela`: quem nao vende (Producao, Designer, Expedicao...) — sem recorte
 *   por vendedor; o que ele ve e decidido parte a parte pela permissao da tela,
 *   como ja acontece nas listas de Producao e de Expedicao.
 */
export function escopoDePedidos(acesso: AcessoUsuario): EscopoDePedidos {
  if (acesso.superAdmin || acesso.permissoes.has('propostas.view_all')) return 'todos';
  return acesso.ehVendedor ? 'proprios' : 'pela_tela';
}

/** Minusculas, sem acento, sem espaco duplo e sem pontuacao no fim ("Edison Jr." = "Edison Jr"). */
export function normalizarNomeDeVendedor(valor: string | null | undefined): string {
  return String(valor ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.\s]+$/, '');
}

/** O pedido e de quem pergunta? Nome vazio de qualquer lado NUNCA casa. */
export function pedidoEDoVendedor(acesso: AcessoUsuario, vendedorDoPedido: string | null | undefined): boolean {
  const meu = normalizarNomeDeVendedor(acesso.nomeComercial);
  const dele = normalizarNomeDeVendedor(vendedorDoPedido);
  return meu !== '' && dele !== '' && meu === dele;
}

/**
 * Retrato de quem pergunta, para o modelo responder "voce pode / peca a quem
 * pode" com os MESMOS nomes que aparecem em Configuracoes > Perfis e Permissoes
 * e nas paginas do manual.
 */
export function descreverQuemPergunta(acesso: AcessoUsuario): Record<string, unknown> {
  if (!acesso.encontrado) {
    return { identificado: false, nota: 'Nao foi possivel ler o perfil de quem pergunta — nao afirme o que ele pode ou nao fazer.' };
  }
  const tudo = acesso.superAdmin;
  return {
    identificado: true,
    nome: acesso.nome,
    perfil: acesso.perfilNome ?? 'sem perfil',
    super_admin: acesso.superAdmin,
    administrador: acesso.admin,
    permissoes_do_perfil: tudo
      ? 'TODAS (Super Admin)'
      : [...acesso.permissoes].filter(c => c !== '*').map(rotuloDaPermissao).sort((a, b) => a.localeCompare(b, 'pt-BR')),
    como_ler:
      'Quando a pagina do manual disser que uma acao exige a permissao X, Administrador ou Super Admin: ' +
      'quem pergunta PODE se X estiver em permissoes_do_perfil, ou se administrador/super_admin for true. ' +
      'Se nao puder, explique o passo a passo do mesmo jeito e diga a quem pedir.',
  };
}
