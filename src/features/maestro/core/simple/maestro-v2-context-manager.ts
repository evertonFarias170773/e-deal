import type { AllowedToolName } from './maestro-v2-router';

export type MaestroV2Domain = 'cliente' | 'financeiro' | 'orcamento_avulso' | 'proposta' | 'boleto' | 'desconhecido';

export interface OrcamentoAvulsoItem {
  quantidade: number;
  termo: string;
}

export interface PendingProductResolution {
  lastRequestedQuantity: number;
  lastRequestedTerm: string;
  status: 'nao_encontrado' | 'preco_incompleto';
}

export interface PendingAmbiguousItem {
  lastRequestedQuantity: number;
  lastRequestedTerm: string;
  options: string[];
}

export interface MaestroV2Context {
  version: number;
  updatedAt: string;
  domain: MaestroV2Domain;
  lastTool?: AllowedToolName;
  activeEntities: {
    clientId?: string;
    clientInternalId?: number;
    clientName?: string;
    proposalId?: string;
    activeIdInt?: number;
  };
  pendingActions: string[];
  lastStructuredAnswer?: any;
  orcamentoItens?: OrcamentoAvulsoItem[];
  pendingProductResolution?: PendingProductResolution | null;
  pendingAmbiguousItem?: PendingAmbiguousItem | null;
  previousOrcamentoItens?: OrcamentoAvulsoItem[];
  lastRequestedQuantity?: number;
}

const CONTEXT_MAX_AGE_MS = 15 * 60 * 1000; // 15 minutos de validade

export function getEmptyV2Context(): MaestroV2Context {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    domain: 'desconhecido',
    activeEntities: {},
    pendingActions: [],
    orcamentoItens: [],
    pendingProductResolution: null,
    pendingAmbiguousItem: null,
    previousOrcamentoItens: [],
    lastRequestedQuantity: undefined
  };
}

export function limparItensInvalidosContexto(v2Ctx: MaestroV2Context): void {
  if (v2Ctx.orcamentoItens) {
    v2Ctx.orcamentoItens = v2Ctx.orcamentoItens.filter(item => {
      const cleanTerm = item.termo.trim().toLowerCase();
      if (!cleanTerm) return false;
      if (cleanTerm.split(/\s+/).length > 4) return false;
      const blacklistedTerms = /\b(boa\s*tarde|bom\s*dia|boa\s*noite|jesus|doido|bagunca|errado|nao|sim|ok|quero|remova|muda|altera|troca|agora|proposta|doida|doideira|que\s*isso|vc|ficou)\b/i;
      if (blacklistedTerms.test(cleanTerm)) return false;
      return true;
    });
  }
}

export function deserializeV2Context(json?: string | null): MaestroV2Context {
  if (!json) return getEmptyV2Context();
  try {
    const ctx = JSON.parse(json) as MaestroV2Context;
    
    const age = Date.now() - new Date(ctx.updatedAt).getTime();
    if (age > CONTEXT_MAX_AGE_MS) {
      console.log(`[MaestroV2Context] Contexto expirado (idade: ${Math.round(age / 1000)}s). Limpando.`);
      return getEmptyV2Context();
    }
    
    limparItensInvalidosContexto(ctx);
    
    return ctx;
  } catch (err) {
    console.warn('[MaestroV2Context] Falha ao deserializar contexto V2. Resetando.', err);
    return getEmptyV2Context();
  }
}

export function serializeV2Context(ctx: MaestroV2Context): string {
  limparItensInvalidosContexto(ctx);
  ctx.updatedAt = new Date().toISOString();
  return JSON.stringify(ctx);
}

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

/**
 * Tenta processar de forma determinística caso seja uma continuação do contexto ativo.
 * Retorna um plano/resultado do roteador ou null se deve seguir o fluxo normal.
 */
function extractCorrectedTerm(clean: string): string | null {
  const correctionPatterns = [
    /\b(?:quis|queria|quero)\s+dizer\s+(?:o|a|os|as)?\s*(.+?)\s*(?:mesmo)?$/i,
    /\bcorrigindo\s*(?: era)?\s*(?:o|a|os|as)?\s*(.+?)\s*(?:mesmo)?$/i,
    /\b(?:era|seria)\s+(?:o|a|os|as)?\s*(.+?)\s*(?:mesmo)?$/i,
    /\bdeixa\s+(?:apenas|so)?\s+(?:o|a|os|as)?\s*(.+?)\s*(?:mesmo)?$/i
  ];
  for (const pattern of correctionPatterns) {
    const match = clean.match(pattern);
    if (match) {
      return match[1].trim();
    }
  }
  const words = clean.split(/\s+/);
  if (words.length <= 2 && !/\b(oi|ola|bom|boa|jesus|doido|bagunca|errado|nao|sim|ok|quero|remova|muda|altera|troca|agora|proposta|doida|doideira)\b/i.test(clean)) {
    return clean;
  }
  return null;
}

function detectAndExecuteChangeAction(clean: string, query: string, v2Ctx: MaestroV2Context): boolean {
  if (!v2Ctx.orcamentoItens || v2Ctx.orcamentoItens.length === 0) return false;

  const isAddition = /\b(add|mais|inclui(r)?|adiciona(r)?)\b/i.test(clean) || clean.includes('+');
  if (isAddition) return false;

  let matchedItemIdx = -1;

  for (let i = 0; i < v2Ctx.orcamentoItens.length; i++) {
    const item = v2Ctx.orcamentoItens[i];
    const normTerm = normalizeText(item.termo);
    if (clean.includes(normTerm)) {
      matchedItemIdx = i;
      break;
    }
  }

  if (matchedItemIdx === -1) {
    const queryWords = clean
      .replace(/\b(troca(r|s|a|am|as)?|altera(r|s|a|am|as)?|muda(r|s|a|am|as)?|atualiza(r|s|a|am|as)?|pra|para|p\/|a|de|o|a|os|as|agora)\b/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2 && !/\d+/.test(w));
      
    for (let i = 0; i < v2Ctx.orcamentoItens.length; i++) {
      const item = v2Ctx.orcamentoItens[i];
      const normTerm = normalizeText(item.termo);
      if (queryWords.some(qw => normTerm.includes(qw))) {
        matchedItemIdx = i;
        break;
      }
    }
  }

  if (matchedItemIdx === -1) return false;

  const numMatch = clean.match(/\b(\d+(?:\.\d+)?)\s*([kk]?)\b/i);
  if (!numMatch) return false;

  const numStr = numMatch[1];
  const isK = numMatch[2].toLowerCase() === 'k';
  let newQtd = parseFloat(numStr);
  if (isK) newQtd *= 1000;

  if (isNaN(newQtd)) return false;

  const isChangeVerb = /\b(troca(r|s|a|am|as)?|altera(r|s|a|am|as)?|muda(r|s|a|am|as)?|atualiza(r|s|a|am|as)?|bota(r|s|a)?|coloca(r|s|a)?|deixa(r|s|a)?|passa(r|s|a)?|agora|pra|para|p\/)\b/i.test(clean);
  const wordCount = clean.split(/\s+/).length;

  if (isChangeVerb || wordCount <= 5) {
    v2Ctx.previousOrcamentoItens = JSON.parse(JSON.stringify(v2Ctx.orcamentoItens || []));

    const queryWords = clean
      .replace(/\b(troca(r|s|a|am|as)?|altera(r|s|a|am|as)?|muda(r|s|a|am|as)?|atualiza(r|s|a|am|as)?|pra|para|p\/|a|de|o|a|os|as|agora)\b/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2 && !/\d+/.test(w));
      
    const matchedQueryWord = queryWords.find(qw => normalizeText(v2Ctx.orcamentoItens![matchedItemIdx].termo).includes(qw));
    
    const oldQtd = v2Ctx.orcamentoItens[matchedItemIdx].quantidade;
    const oldTerm = v2Ctx.orcamentoItens[matchedItemIdx].termo;
    
    v2Ctx.orcamentoItens[matchedItemIdx].quantidade = newQtd;
    if (matchedQueryWord && matchedQueryWord !== normalizeText(oldTerm)) {
      v2Ctx.orcamentoItens[matchedItemIdx].termo = matchedQueryWord;
    }
    
    v2Ctx.lastRequestedQuantity = newQtd;
    
    console.log(`[MaestroV2Context] Ação: Alterar quantidade parcial detectada.`);
    console.log(`- Orçamento antes: ${JSON.stringify(v2Ctx.previousOrcamentoItens)}`);
    console.log(`- Item alvo: "${oldTerm}"`);
    console.log(`- Mutação: ${oldQtd} -> ${newQtd} (Termo temporário: "${v2Ctx.orcamentoItens[matchedItemIdx].termo}")`);
    console.log(`- Orçamento depois: ${JSON.stringify(v2Ctx.orcamentoItens)}`);
    return true;
  }

  return false;
}

export function handleContextContinuation(
  query: string,
  v2Ctx: MaestroV2Context,
  activeClient: any
): { routed: boolean; plan: any } | null {
  const clean = normalizeText(query);

  const regexClient1 = /\b(cliente|cli|cadastro)\s*([a-z\d]+)/i;
  const regexClient2 = /\bc\s*\d+/i;
  if (regexClient1.test(clean) || regexClient2.test(clean)) {
    console.log('[MaestroV2Context] Comando de cliente explícito detectado. Suspendendo orçamento avulso.');
    v2Ctx.domain = 'cliente';
    return null;
  }

  const isBackToOrcamento = /\b(voltar\s*(ao|para\s*o)?\s*orcamento\s*(anterior)?)\b/i.test(clean);
  if (isBackToOrcamento) {
    if (v2Ctx.orcamentoItens && v2Ctx.orcamentoItens.length > 0) {
      console.log('[MaestroV2Context] Ação: Pedido de retorno ao orçamento anterior.');
      v2Ctx.domain = 'orcamento_avulso';
      return {
        routed: true,
        plan: {
          steps: [
            {
              tool: 'voltar_orcamento_anterior',
              params: {}
            }
          ]
        }
      };
    }
  }

  if (v2Ctx.domain === 'orcamento_avulso' && v2Ctx.lastTool === 'voltar_orcamento_anterior') {
    const isPositive = /\b(sim|quero|pode\s*ser|monte|ok|claro|positivo|novamente)\b/i.test(clean);
    if (isPositive) {
      console.log('[MaestroV2Context] Ação: Confirmação positiva para restaurar orçamento.');
      return {
        routed: true,
        plan: {
          steps: [
            {
              tool: 'simularOrcamentoAvulso',
              params: { itens: v2Ctx.orcamentoItens }
            }
          ]
        }
      };
    }
  }

  if (v2Ctx.domain === 'orcamento_avulso') {
    const hasPending = !!v2Ctx.pendingProductResolution;
    const hasAmbiguous = !!v2Ctx.pendingAmbiguousItem;
    
    const isQuantityReference = /\b(mas\s*na\s*quantidade|na\s*qtd|quantidade\s*anterior|com\s*os|que\s*eu\s*pedi|quantidade\s*que\s*falei)\b/i.test(clean);
    const isSameQtd = /\b(a\s*mesma\s*(de\s*antes)?|mesma\s*quantidade|na\s*quantidade\s*anterior|qtd\s*anterior)\b/i.test(clean);
    const isKeep = /\b(mantem|manter|mantenha|deixa|deixar|deixe|volta|voltar|volte)\b/i.test(clean);

    const hasNumber = /\d+/.test(clean);
    const isClear = /\b(limpa(r)?\s*orcamento|comeca(r)?\s*de\s*novo|limpar)\b/i.test(clean);
    const isRemove = /\b(remove|remova|remover|tira|tirar|exclui|exclua|excluir|deleta|deletar)\b/i.test(clean);
    const isChange = /\b(troca|trocar|altera|alterar|muda|mudar|atualiza|atualizar|bota|botar|coloca|colocar|deixa|deixar|passa|passar|agora|pra|para|p\/)\b/i.test(clean);
    const isMerge = /\b(os\s*dois|os\s*2|no\s*mesmo\s*orcamento|juntar)\b/i.test(clean);
    const isRecalc = /\b(quanto\s*ficou|total|agora)\b/i.test(clean);

    const isCorrection = /\b(quis\s*dizer|corrigindo|era|digitei\s*errado)\b/i.test(clean) || (hasPending || hasAmbiguous);
    const isReaction = /\b(jesus|doido|doida|bagunca|que\s*isso|louco|pirou|confuso|doido|ficou\s*errado|que\s*bagunca|doido|doideira)\b/i.test(clean) && !/\b(quis\s*dizer|corrigindo|era|digitei\s*errado)\b/i.test(clean);

    // 1. PRIORIDADE: Reação/Reclamação do usuário
    if (isReaction) {
      console.log('[MaestroV2Context] Reação/Reclamação do usuário detectada. Ativando recuperação.');
      return {
        routed: true,
        plan: {
          steps: [
            {
              tool: 'recuperacao_orcamento_avulso',
              params: {}
            }
          ]
        }
      };
    }

    // 2. Correção de pendência (sem número)
    if (isCorrection && !hasNumber && !isClear && !isRemove && !isChange && !isMerge && !isRecalc && !isQuantityReference && !isKeep && !isSameQtd && !isReaction) {
      const correctedTerm = extractCorrectedTerm(clean);
      if (correctedTerm) {
        let pendingQtd = v2Ctx.pendingProductResolution?.lastRequestedQuantity || 
                         v2Ctx.pendingAmbiguousItem?.lastRequestedQuantity;
        if (pendingQtd) {
          console.log(`[MaestroV2Context] Correção de produto detectada. Termo: "${correctedTerm}", Quantidade: ${pendingQtd}`);
          v2Ctx.previousOrcamentoItens = JSON.parse(JSON.stringify(v2Ctx.orcamentoItens || []));
          
          const newItem: OrcamentoAvulsoItem = {
            quantidade: pendingQtd,
            termo: correctedTerm
          };
          
          const current = v2Ctx.orcamentoItens || [];
          const normNew = normalizeText(newItem.termo);
          const existingIdx = current.findIndex(item => normalizeText(item.termo) === normNew);
          if (existingIdx >= 0) {
            current[existingIdx].quantidade = pendingQtd;
          } else {
            current.push(newItem);
          }
          v2Ctx.orcamentoItens = current;
          v2Ctx.lastRequestedQuantity = pendingQtd;

          return {
            routed: true,
            plan: {
              steps: [
                {
                  tool: 'simularOrcamentoAvulso',
                  params: { itens: v2Ctx.orcamentoItens }
                }
              ]
            }
          };
        }
      }
    }

    if (isSameQtd) {
      let targetQtd = v2Ctx.pendingProductResolution?.lastRequestedQuantity || 
                      v2Ctx.pendingAmbiguousItem?.lastRequestedQuantity || 
                      v2Ctx.lastRequestedQuantity;
      console.log(`[MaestroV2Context] Ação: Pedido de quantidade anterior detectado. Qtd resolvida: ${targetQtd}`);
      if (targetQtd && v2Ctx.orcamentoItens && v2Ctx.orcamentoItens.length > 0) {
        v2Ctx.previousOrcamentoItens = JSON.parse(JSON.stringify(v2Ctx.orcamentoItens || []));
        v2Ctx.orcamentoItens[v2Ctx.orcamentoItens.length - 1].quantidade = targetQtd;
        v2Ctx.pendingProductResolution = null;
        v2Ctx.pendingAmbiguousItem = null;
        return {
          routed: true,
          plan: {
            steps: [
              {
                tool: 'simularOrcamentoAvulso',
                params: { itens: v2Ctx.orcamentoItens }
              }
            ]
          }
        };
      }
    }

    if (isQuantityReference) {
      const numMatch = clean.match(/\b\d+\b/);
      let targetQtd = v2Ctx.pendingProductResolution?.lastRequestedQuantity || 
                      v2Ctx.pendingAmbiguousItem?.lastRequestedQuantity;
      
      if (!targetQtd && numMatch) {
        targetQtd = parseInt(numMatch[0], 10);
      }
      if (!targetQtd && v2Ctx.orcamentoItens && v2Ctx.orcamentoItens.length > 0) {
        targetQtd = v2Ctx.orcamentoItens[v2Ctx.orcamentoItens.length - 1].quantidade;
      }
      
      console.log(`[MaestroV2Context] Referência de quantidade detectada. Restaurando quantidade: ${targetQtd}`);
      if (targetQtd && v2Ctx.orcamentoItens && v2Ctx.orcamentoItens.length > 0) {
        v2Ctx.previousOrcamentoItens = JSON.parse(JSON.stringify(v2Ctx.orcamentoItens || []));
        v2Ctx.orcamentoItens[v2Ctx.orcamentoItens.length - 1].quantidade = targetQtd;
      }
      v2Ctx.pendingProductResolution = null;
      v2Ctx.pendingAmbiguousItem = null;
      return {
        routed: true,
        plan: {
          steps: [
            {
              tool: 'simularOrcamentoAvulso',
              params: { itens: v2Ctx.orcamentoItens }
            }
          ]
        }
      };
    }

    if (isKeep) {
      const productTerm = clean
        .replace(/\b(mante(m|r|nha|nham|nas)?|deixa(r|s|a|am|as)?|volta(r|s|a|am|as)?|o|a|os|as|no|em|orcamento|anterior|item|da\s*proposta|de\s*antes)\b/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      if (productTerm) {
        const normTerm = normalizeText(productTerm);
        const alreadyActive = (v2Ctx.orcamentoItens || []).find(item => normalizeText(item.termo).includes(normTerm));

        if (alreadyActive) {
          console.log(`[MaestroV2Context] Ação: Manter item "${alreadyActive.termo}" (já está ativo).`);
          return {
            routed: true,
            plan: {
              steps: [
                {
                  tool: 'simularOrcamentoAvulso',
                  params: { itens: v2Ctx.orcamentoItens }
                }
              ]
            }
          };
        } else {
          const historical = (v2Ctx.previousOrcamentoItens || []).find(item => normalizeText(item.termo).includes(normTerm));
          if (historical) {
            console.log(`[MaestroV2Context] Ação: Restaurar item "${historical.termo}" do snapshot com quantidade ${historical.quantidade}.`);
            v2Ctx.orcamentoItens = v2Ctx.orcamentoItens || [];
            v2Ctx.orcamentoItens.push({ ...historical });

            return {
              routed: true,
              plan: {
                steps: [
                  {
                    tool: 'simularOrcamentoAvulso',
                    params: { itens: v2Ctx.orcamentoItens }
                  }
                ]
              }
            };
          }
        }
      }
    }

    if (detectAndExecuteChangeAction(clean, query, v2Ctx)) {
      return {
        routed: true,
        plan: {
          steps: [
            {
              tool: 'simularOrcamentoAvulso',
              params: { itens: v2Ctx.orcamentoItens }
            }
          ]
        }
      };
    }

    if (!hasNumber && !isClear && !isRemove && !isChange && !isMerge && !isRecalc && !isQuantityReference && !isKeep && !isSameQtd && !isReaction) {
      if (clean.length > 2 && !/\b(oi|ola|bom\s*dia|boa\s*tarde|boa\s*noite|ok|sim|nao|quero)\b/i.test(clean)) {
        console.log('[MaestroV2Context] Termo de produto sem quantidade e sem pendência. Perguntando quantidade.');
        return {
          routed: true,
          plan: {
            steps: [
              {
                tool: 'perguntar_quantidade_orcamento',
                params: {}
              }
            ]
          }
        };
      }
    }

    if (isClear) {
      v2Ctx.previousOrcamentoItens = JSON.parse(JSON.stringify(v2Ctx.orcamentoItens || []));
      v2Ctx.orcamentoItens = [];
      v2Ctx.pendingProductResolution = null;
      v2Ctx.pendingAmbiguousItem = null;
      console.log('[MaestroV2Context] Ação: Limpar Orçamento.');
      return {
        routed: true,
        plan: {
          steps: [
            {
              tool: 'limpar_orcamento_avulso',
              params: {}
            }
          ]
        }
      };
    }

    if (isRemove) {
      let removePart = clean;
      const keepIndex = clean.search(/\b(deixa(r|s|a|am|as)?|mante(m|r|nha|nham)?|volta(r|s|a|am)?)\b/i);
      if (keepIndex >= 0) {
        removePart = clean.substring(0, keepIndex).trim();
      }

      let cleanQueryForRemoval = removePart
        .replace(/\b(da\s*proposta|do\s*orcamento|o|a|os|as)\b/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
        
      const matchRemove = cleanQueryForRemoval.match(/\b(?:remove|remova|tira|exclui|exclua|deleta)\s+(.+)$/i);
      if (matchRemove) {
        const termoToRemove = normalizeText(matchRemove[1]);
        const originalCount = v2Ctx.orcamentoItens?.length || 0;
        
        v2Ctx.previousOrcamentoItens = JSON.parse(JSON.stringify(v2Ctx.orcamentoItens || []));
        
        v2Ctx.orcamentoItens = (v2Ctx.orcamentoItens || []).filter(item => {
          return !normalizeText(item.termo).includes(termoToRemove);
        });
        console.log(`[MaestroV2Context] Ação: Remover item "${termoToRemove}". Removidos: ${originalCount - v2Ctx.orcamentoItens.length}`);
      }
      return {
        routed: true,
        plan: {
          steps: [
            {
              tool: 'simularOrcamentoAvulso',
              params: { itens: v2Ctx.orcamentoItens }
            }
          ]
        }
      };
    }

    if (isMerge || isRecalc) {
      console.log('[MaestroV2Context] Ação: Recalcular/Consolidar.');
      return {
        routed: true,
        plan: {
          steps: [
            {
              tool: 'simularOrcamentoAvulso',
              params: { itens: v2Ctx.orcamentoItens }
            }
          ]
        }
      };
    }

    const parsedNewItems = parseOrcamentoAvulsoItems(query);
    const hasBudgetKeyword = /\b(orcamento|valor|preco|cotacao|custa)\b/i.test(clean);
    
    if (hasBudgetKeyword && !parsedNewItems && !isClear && !isRemove && !isChange && !isMerge && !isRecalc) {
      console.log('[MaestroV2Context] Ambiguidade detectada no domínio orçamento_avulso. Perguntando continuação.');
      return {
        routed: true,
        plan: {
          steps: [
            {
              tool: 'perguntar_continuacao_orcamento',
              params: {}
            }
          ]
        }
      };
    }

    if (parsedNewItems) {
      v2Ctx.previousOrcamentoItens = JSON.parse(JSON.stringify(v2Ctx.orcamentoItens || []));
      
      const cleanStartsAddition = /^\s*(?:add|mais|\+|inclui(r)?|adiciona(r)?|insere|coloca(r)?)\b/i.test(clean);
      if (cleanStartsAddition) {
        console.log('[MaestroV2Context] Ação: Adicionar novos itens (acumulativo):', parsedNewItems);
        const current = v2Ctx.orcamentoItens || [];
        for (const newItem of parsedNewItems) {
          const normNew = normalizeText(newItem.termo);
          const existingIdx = current.findIndex(item => normalizeText(item.termo) === normNew);
          if (existingIdx >= 0) {
            current[existingIdx].quantidade += newItem.quantidade;
          } else {
            current.push(newItem);
          }
          v2Ctx.lastRequestedQuantity = newItem.quantidade;
        }
        v2Ctx.orcamentoItens = current;
      } else {
        console.log('[MaestroV2Context] Ação: Substituir lista de itens explícita:', parsedNewItems);
        v2Ctx.orcamentoItens = parsedNewItems;
        v2Ctx.lastRequestedQuantity = parsedNewItems[0].quantidade;
        v2Ctx.pendingProductResolution = null;
        v2Ctx.pendingAmbiguousItem = null;
      }

      return {
        routed: true,
        plan: {
          steps: [
            {
              tool: 'simularOrcamentoAvulso',
              params: { itens: v2Ctx.orcamentoItens }
            }
          ]
        }
      };
    }
  }

  // 3. DOMÍNIO: FINANCEIRO (Confirmações)
  if (v2Ctx.domain === 'financeiro') {
    const isConfirmation = /\b(tem\s*certeza|confirma|confere|qual\s*a\s*fonte|origem|origem\s*do\s*dado)\b/i.test(clean);
    if (isConfirmation) {
      console.log('[MaestroV2Context] Confirmação financeira detectada. Roteando para revalidarUltimaConsulta.');
      return {
        routed: true,
        plan: {
          steps: [
            {
              tool: 'revalidarUltimaConsulta',
              params: {}
            }
          ]
        }
      };
    }
  }

  return null;
}

/**
 * Função utilitária para extração rápida de itens avulsos em mensagens de continuação.
 */
function parseOrcamentoAvulsoItems(query: string): OrcamentoAvulsoItem[] | null {
  const clean = query
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();

  const splitRegex = /(?:\s*\+\s*|\s*,\s*|\s+(?:e|ou)\s+)/i;
  const parts = clean.split(splitRegex);
  const items: OrcamentoAvulsoItem[] = [];

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    let phrase = trimmed
      .replace(/\b(add|mais|inclui|incluir|coloca|colocar|boa tarde|bom dia|boa noite|ola|oi|por favor|gentileza|queria|gostaria|qual|o|valor|preco|cotacao|orcamento|pra|para|de|um|uma|unidades|unidade|un|unid|unids|pecas|peca)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (!phrase) continue;

    const regexNumBefore = /^(\d+(?:\.\d+)?)\s*([kk]?)\s*(.+)$/i;
    const regexNumAfter = /^(.+?)\s*(\d+(?:\.\d+)?)\s*([kk]?)$/i;

    let match = phrase.match(regexNumBefore);
    if (match) {
      const numStr = match[1];
      const isK = match[2].toLowerCase() === 'k';
      const termo = match[3].replace(/[?]/g, '').trim();
      
      let qtd = parseFloat(numStr);
      if (isK) qtd *= 1000;
      
      if (termo && !isNaN(qtd)) {
        items.push({ quantidade: qtd, termo });
        continue;
      }
    }

    match = phrase.match(regexNumAfter);
    if (match) {
      const termo = match[1].replace(/[?]/g, '').trim();
      const numStr = match[2];
      const isK = match[3].toLowerCase() === 'k';
      
      let qtd = parseFloat(numStr);
      if (isK) qtd *= 1000;
      
      if (termo && !isNaN(qtd)) {
        items.push({ quantidade: qtd, termo });
        continue;
      }
    }
  }

  return items.length > 0 ? items : null;
}
