export interface OrcamentoAvulsoItem {
  quantidade: number;
  termo: string;
  produtoId?: number;
  precoUnitario?: number;
  unidadeMedida?: string;
  pesoUnitario?: number;
  valorFixo?: number;
}

export interface PendingAmbiguousOption {
  id: number;
  name: string;
  index: number;
}

export interface OrcamentoAvulsoState {
  itens: OrcamentoAvulsoItem[];
  pendingAmbiguity: boolean;
  pendingTerm?: string;
  pendingQuantidade?: number;
  pendingOptions?: PendingAmbiguousOption[];
  /** Itens do orçamento antes da última alteração destrutiva (usado para RESTORE) */
  previousItens?: OrcamentoAvulsoItem[];
}

export type OrcamentoActionType = 'ADD' | 'REPLACE' | 'UPDATE_QTD' | 'REMOVE' | 'RESTORE' | 'CLEAR' | 'NONE' | 'ERROR';

export interface OrcamentoResult {
  action: OrcamentoActionType;
  items: OrcamentoAvulsoItem[];
  pending: any;
  errors: string[];
  nextState: OrcamentoAvulsoState;
  response: string;
}

import { processarMedidas, processarValorMonetario } from './maestro-orcamento-medidas';
import { resolverTermoCatalogo } from './maestro-orcamento-catalogo-oficial';

export function processarOrcamentoAvulso(query: string, state: OrcamentoAvulsoState): OrcamentoResult {
  let clean = query
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // remove acentos
    .trim();

  // Remover menções a cliente para não poluir o nome do produto no parse
  // Ex: "5000 triband para o cli 8469" vira "5000 triband"
  clean = clean.replace(/\b(para|pro|pra|ao)?\s*(o\s+)?(cliente|cli|cadastro)\s+(\d+|[a-z]+)\b/gi, ' ').trim();

  // Defesa adicional: limpar menções naturais como "para [NomeCliente]" se não coincidir com termo de produto
  clean = clean.replace(/\b(para|pro|pra|ao)\s+(?:o\s+|a\s+)?([a-z][a-z\s]{2,30}?)(?=\s*[:,]|\s+com\b|\s+\d|\s*$)/gi, (match, prep, name) => {
    const res = resolverTermoCatalogo(name.trim());
    if (res && res.tipoMatch !== 'nao_encontrado') {
      return match; // Preserva se for um produto (falso positivo)
    }
    return ' ';
  }).trim();

  const nextState = { ...state, itens: [...state.itens] };

  // 1. Tratar "assim não dá", "cancela", "esquece"
  if (/\b(assim\s*nao\s*da|cancela|esquece|limpa|para\s*tudo)\b/i.test(clean)) {
    return {
      action: 'CLEAR',
      items: [],
      pending: null,
      errors: [],
      nextState: { itens: [], pendingAmbiguity: false },
      response: 'Orçamento avulso cancelado e limpo.'
    };
  }

  // 3. Tratar resolução de ambiguidade
  if (state.pendingAmbiguity && state.pendingOptions && state.pendingOptions.length > 0) {
    let resolvedId: number | null = null;
    let resolvedName: string | null = null;

    // a) Escolha por número da opção (ex: "1", "opcao 1", "quero a 2", "esse 19")
    const optionMatch = /^(?:(?:use?|escolho|quero|pode|coloca|esse|essa|opcao)\s+(?:a\s+|o\s+|))?(?:opcao\s+)?(\d+)\b/i.exec(clean);
    if (optionMatch) {
      const idx = parseInt(optionMatch[1], 10);
      const option = state.pendingOptions.find(o => o.index === idx);
      if (option) {
        resolvedId = option.id;
        resolvedName = option.name;
      }
    }

    // b) Escolha por ID direto (ex: "101")
    if (!resolvedId) {
      const idMatch = /^(?:(?:use?|escolho|quero|pode|coloca|esse|essa|id|codigo)\s+(?:a\s+|o\s+|))?(?:id\s+|codigo\s+)?(\d+)\b/i.exec(clean);
      if (idMatch) {
        const idStr = parseInt(idMatch[1], 10);
        const option = state.pendingOptions.find(o => o.id === idStr);
        if (option) {
          resolvedId = option.id;
          resolvedName = option.name;
        }
      }
    }

    // c) Escolha por nome do produto
    if (!resolvedId) {
      const option = state.pendingOptions.find(o => 
        normalizarTermoEngine(o.name).includes(clean) || clean.includes(normalizarTermoEngine(o.name))
      );
      if (option) {
        resolvedId = option.id;
        resolvedName = option.name;
      }
    }

    if (resolvedId !== null) {
      const resolvedItem = {
        quantidade: state.pendingQuantidade || 1,
        termo: state.pendingTerm || '',
        produtoId: resolvedId
      };
      nextState.itens.push(resolvedItem);
      nextState.pendingAmbiguity = false;
      nextState.pendingTerm = undefined;
      nextState.pendingQuantidade = undefined;
      nextState.pendingOptions = undefined;
      
      return {
        action: 'ADD',
        items: nextState.itens,
        pending: null,
        errors: [],
        nextState,
        response: `Produto resolvido: ${resolvedName || resolvedId}.`
      };
    }
  }

  // 4. Tratar número solto quando houver pendência de produto (bloqueia o router)
  const isLooseNumber = /^(?:(?:use?|escolho|quero|pode|coloca|esse|essa|opcao)\s+(?:a\s+|o\s+|))?(?:opcao\s+)?(\d+)\s*$/i.test(clean);
  if (isLooseNumber && (state.pendingAmbiguity || !!state.pendingTerm)) {
    return {
      action: 'NONE',
      items: state.itens,
      pending: null,
      errors: [],
      nextState: state,
      response: ''
    };
  }

  // 4b. Tratar alteração de quantidade pendente
  // Ex: "quantidade é 500", "qtd 200"
  const qtyMatch = /\b(?:quant\w*|qtd|quantidade)(?:\s+(?:e|eh|é|de|para|pra|=))?\s+(\d+(?:\.\d+)?k?)\b/i.exec(clean);
  if (qtyMatch && (state.pendingAmbiguity || !!state.pendingTerm)) {
    let qtd = parseFloat(qtyMatch[1].replace(/\./g, ''));
    if (qtyMatch[1].includes('.') && qtyMatch[1].split('.')[1].length !== 3) qtd = parseFloat(qtyMatch[1]);
    if (qtyMatch[1].toLowerCase().endsWith('k')) qtd *= 1000;
    
    // Como a pendência fica isolada em nextState, vamos apenas atualizar.
    // Retornamos UPDATE_QTD para o router manter o estado pendente.
    nextState.pendingQuantidade = qtd;
    return {
      action: 'UPDATE_QTD',
      items: state.itens,
      pending: null,
      errors: [],
      nextState,
      response: `Quantidade atualizada para ${qtd}.`
    };
  }

  // 5a. Detectar REMOVE — "remove as triband", "tira as triband", "sem as triband",
  //   "refaz sem as triband", "retira as triband", "exclui as triband"
  //   Nota: "sem as" sozinho sem produto não dispara (requer match de item existente)
  const isRemoveIntent = /\b(remove|retira|tira(r)?|exclui(r)?)\b/i.test(clean)
    || /\bsem\s+a(s)?\s+\w/i.test(clean)
    || /\brefaz(er)?\s+(o\s+)?(orcamento|pedido)\s+sem\b/i.test(clean)
    || /\brecalcula(r)?\s+(o\s+)?(orcamento|pedido)\s+sem\b/i.test(clean);

  // REMOVE nunca deve ser confundido com "cliente remove" ou "remove cliente"
  const isClientRemove = /\b(remove|retira|tira)\s+(o\s+)?(cliente|cadastro)\b/i.test(clean);

  if (isRemoveIntent && !isClientRemove && state.itens.length > 0) {
    const cleanWords = clean.split(/\s+/).filter(w => w.length > 2);
    const itensParaRemover = state.itens.filter(item =>
      cleanWords.some(w => {
        const termoNorm = normalizarTermoEngine(item.termo);
        return termoNorm.includes(w) || w.includes(termoNorm);
      })
    );
    if (itensParaRemover.length > 0) {
      const novosItens = state.itens.filter(i => !itensParaRemover.includes(i));
      nextState.previousItens = JSON.parse(JSON.stringify(state.itens));
      nextState.itens = novosItens;
      return {
        action: 'REMOVE',
        items: novosItens,
        pending: null,
        errors: [],
        nextState,
        response: `Removido: ${itensParaRemover.map(i => i.termo).join(', ')}.`
      };
    }
    // Frase de remoção mas nenhum produto identificado — mantém estado atual
    return {
      action: 'NONE',
      items: state.itens,
      pending: null,
      errors: [],
      nextState: state,
      response: ''
    };
  }

  // 5b. Detectar RESTORE — "mantem", "volta", "coloca de volta", "não tira", "preserva", "restaura"

  const isRestoreIntent = /\b(mantem|mantém|mantém|volta\s+o|volta\s+a|coloca\s+de\s+volta|nao\s+tira|nao\s+remove|preserva|restaura|manter)\b/i.test(clean);
  if (isRestoreIntent) {
    const previousItens = state.previousItens || [];
    // Identifica itens que estavam antes mas não estão agora
    const removedItens = previousItens.filter(prev =>
      !state.itens.some(cur => normalizarTermoEngine(cur.termo) === normalizarTermoEngine(prev.termo))
    );
    // Identifica itens mencionados na frase que existem no histórico
    const cleanWords = clean.split(/\s+/).filter(w => w.length > 2);
    const itensParaRestaurar = removedItens.filter(item =>
      cleanWords.some(w => normalizarTermoEngine(item.termo).includes(w) || w.includes(normalizarTermoEngine(item.termo)))
    );
    if (itensParaRestaurar.length > 0) {
      const novosItens = [...state.itens, ...itensParaRestaurar];
      nextState.itens = novosItens;
      nextState.previousItens = JSON.parse(JSON.stringify(state.itens));
      return {
        action: 'RESTORE',
        items: novosItens,
        pending: null,
        errors: [],
        nextState,
        response: `Restaurado: ${itensParaRestaurar.map(i => i.termo).join(', ')}.`
      };
    }
    // Se não há itens removidos mas a frase menciona algo — mantém o estado atual
    return {
      action: 'NONE',
      items: state.itens,
      pending: null,
      errors: [],
      nextState: state,
      response: ''
    };
  }

  // 5b. Tratar alteração de quantidade:
  //   - "muda a qtd do mobi pra 10k"
  //   - "muda pra 200 tex"
  //   - "muda a quantidade do mobi para 10.000"
  //   - "altera tex pra 200"
  const isBudgetChange = /\b(muda|altera|troca|atualiza|recalcula|recalcule|sao|são|corrige)\b/i.test(clean);
  // Também detecta padrão de quantificação direta sem "muda": "pra 200 tex" com estado ativo e produto identificável
  const isDirectQtyUpdate = state.itens.length > 0 && /\bpra\s+(\d+(?:\.\d+)?k?)\s+([a-z][a-z\d\s-]+)$/i.test(clean);
  const hasMultipleQty = /\b\d+(?:\.\d+)?k?\s+[a-z][a-z\d\s-]*\s+(?:e|\+|mais|,)\s+\d+(?:\.\d+)?k?\s+[a-z]/i.test(clean) || (clean.match(/\b\d+(?:\.\d+)?k?\b/gi) || []).length > 1;
  const isSingleItemUpdate = state.itens.length > 0 && !hasMultipleQty && /^(?:sao\s+|são\s+|)?(\d+(?:\.\d+)?k?)\s+([a-z][a-z\d\s-]+)$/i.test(clean);

  if ((isBudgetChange || isDirectQtyUpdate || isSingleItemUpdate) && state.itens.length > 0 && !hasMultipleQty) {
    const numMatch = clean.match(/\b(\d+(?:\.\d+)?)\s*([k]?)\b/i);
    if (numMatch) {
      let qtd = parseFloat(numMatch[1].replace(/\./g, '')); // 10.000 -> 10000
      if (numMatch[1].includes('.') && numMatch[1].split('.')[1].length !== 3) {
        qtd = parseFloat(numMatch[1]);
      }
      if (numMatch[2].toLowerCase() === 'k') qtd *= 1000;

      const cleanWords = clean.split(/\s+/);
      let targetIdx = -1;
      for (let i = 0; i < state.itens.length; i++) {
        const termoNorm = normalizarTermoEngine(state.itens[i].termo);
        // Match: palavra da query tem ≥3 chars e o termo do item contém essa palavra OU vice-versa
        if (cleanWords.some(w => {
          if (w.length < 2) return false;
          return termoNorm.includes(w) || w.includes(termoNorm);
        })) {
          targetIdx = i;
          break;
        }
      }

      if (targetIdx !== -1) {
        nextState.previousItens = JSON.parse(JSON.stringify(state.itens));
        nextState.itens[targetIdx] = { ...nextState.itens[targetIdx], quantidade: qtd };
        return {
          action: 'UPDATE_QTD',
          items: nextState.itens,
          pending: null,
          errors: [],
          nextState,
          response: `Quantidade de ${state.itens[targetIdx].termo} alterada para ${qtd}.`
        };
      } else if (state.itens.length === 1) {
        // Fallback: se há apenas 1 item, altera a quantidade desse único item, ignorando o match falho
        nextState.previousItens = JSON.parse(JSON.stringify(state.itens));
        nextState.itens[0] = { ...nextState.itens[0], quantidade: qtd };
        return {
          action: 'UPDATE_QTD',
          items: nextState.itens,
          pending: null,
          errors: [],
          nextState,
          response: `Quantidade alterada para ${qtd}.`
        };
      } else {
        // Fallback: múltiplos itens, mas não deu match em nenhum específico -> pedir desambiguação
        return {
          action: 'NONE',
          items: state.itens,
          pending: null,
          errors: [],
          nextState: state,
          response: `Como há ${state.itens.length} produtos no orçamento, para qual deles você quer alterar a quantidade?`
        };
      }
    }
  }

  // 6. Parse genérico de itens (+, e, etc)
  // Pre-processamento: "1000 mobi 1 1000 tex" -> transforma número solto em vírgula para não quebrar o parse
  const preProcessed = clean.replace(/\s+[1-9]\s+(?=\d{2,})/g, ' , ');

  const items = parseOrcamento(preProcessed);
  if (items.length > 0) {
    const isExplicitAddition = /\b(add|inclui(r)?|adiciona(r)?)\b/i.test(clean);
    const hasPlusOrMais = clean.includes('+') || /\bmais\b/i.test(clean);
    
    const isFullReplace = /\b(so|só|apenas|qual valor|orcamento|custa|refaz|refazer|tudo|orco|faz\s+com|troca\s+para)\b/i.test(clean);

    // Se temos >1 itens na query, ou uma flag explicita de replace, é REPLACE.
    // O router só deixará cair aqui para >1 itens quando a intenção for clara de recriar a lista.
    if (state.itens.length > 0 && (isFullReplace || items.length > 1 || /^(?:só|so|apenas)\s+/i.test(clean))) {
      // É replace puro
      nextState.previousItens = JSON.parse(JSON.stringify(state.itens));
      nextState.itens = items;
      return {
        action: 'REPLACE',
        items: nextState.itens,
        pending: null,
        errors: [],
        nextState,
        response: `Substituído pelos itens: ${items.map(i => i.termo).join(', ')}`
      };
    } else {
      const isAddition = isExplicitAddition || (state.itens.length > 0 && (hasPlusOrMais && (clean.startsWith('+') || clean.startsWith('mais'))));
      nextState.previousItens = JSON.parse(JSON.stringify(state.itens));
      nextState.itens = isAddition ? [...state.itens, ...items] : items;
      return {
        action: state.itens.length === 0 ? 'ADD' : (isAddition ? 'ADD' : 'REPLACE'),
        items: nextState.itens,
        pending: null,
        errors: [],
        nextState,
        response: `Adicionado/substituído itens: ${items.map(i => i.termo).join(', ')}`
      };
    }
  }

  return {
    action: 'NONE',
    items: state.itens,
    pending: null,
    errors: [],
    nextState,
    response: ''
  };
}

/** Normaliza um termo de produto para comparação (lowercase, sem acento, trim) */
function normalizarTermoEngine(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseOrcamento(clean: string): OrcamentoAvulsoItem[] {
  const splitRegex = /(?:\s*\+\s*|\s*,\s*|\s+(?:e|ou|mais)\s+)/i;
  const parts = clean.split(splitRegex);
  const items: OrcamentoAvulsoItem[] = [];

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    const matchBefore = trimmed.match(/\b(\d+(?:\.\d+)?)\s*([kk]?)\s+([a-z\d\s-]+)/i);
    if (matchBefore) {
      let numStr = matchBefore[1];
      const isK = matchBefore[2].toLowerCase() === 'k';
      const termo = matchBefore[3].replace(/[?]/g, '').trim();
      
      let qtd = parseFloat(numStr.replace(/\./g, ''));
      if (numStr.includes('.') && numStr.split('.')[1].length !== 3) {
        qtd = parseFloat(numStr);
      }
      if (isK) qtd *= 1000;
      
      const cleanTerm = termo
        .replace(/\b(pra|para|de|um|uma|unidades|unidade|un|unid|unids|und|unds|pecas|peca|mim|orcar|orçar|pode|gostaria|queria|valor|preco|preço|cotacao|cotação|orcamento|orçamento|qual|quanto|custa|orco|orça|do\s*produto|produto|id|prod)\b/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      
      if (cleanTerm && !isNaN(qtd)) {
        items.push({ quantidade: qtd, termo: cleanTerm });
        continue;
      }
    }
  }

  return items;
}
