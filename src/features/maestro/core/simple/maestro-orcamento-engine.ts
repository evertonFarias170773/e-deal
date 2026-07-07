export interface OrcamentoAvulsoItem {
  quantidade: number;
  termo: string;
  produtoId?: number;
  precoUnitario?: number;
  unidadeMedida?: string;
}

export interface OrcamentoAvulsoState {
  itens: OrcamentoAvulsoItem[];
  pendingAmbiguity: boolean;
  pendingTerm?: string;
  pendingQuantidade?: number;
}

export type OrcamentoActionType = 'ADD' | 'REPLACE' | 'UPDATE_QTD' | 'REMOVE' | 'CLEAR' | 'NONE' | 'ERROR';

export interface OrcamentoResult {
  action: OrcamentoActionType;
  items: OrcamentoAvulsoItem[];
  pending: any;
  errors: string[];
  nextState: OrcamentoAvulsoState;
  response: string;
}

export function processarOrcamentoAvulso(query: string, state: OrcamentoAvulsoState): OrcamentoResult {
  const clean = query
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // remove acentos
    .trim();

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

  // 2. Tratar "cliente 101" (deve ignorar e retornar NONE para deixar o router principal agir)
  if (/\b(cliente|cli|cadastro)\s*(\d+|[a-z]+)\b/i.test(clean) || /\bc\s*\d+/i.test(clean)) {
    return {
      action: 'NONE',
      items: state.itens,
      pending: null,
      errors: [],
      nextState: state,
      response: ''
    };
  }

  // 3. Tratar resolução de ambiguidade ("101" com pendência)
  if (state.pendingAmbiguity && /^\d+$/.test(clean)) {
    const id = parseInt(clean, 10);
    const resolvedItem = {
      quantidade: state.pendingQuantidade || 1,
      termo: state.pendingTerm || '',
      produtoId: id
    };
    nextState.itens.push(resolvedItem);
    nextState.pendingAmbiguity = false;
    nextState.pendingTerm = undefined;
    nextState.pendingQuantidade = undefined;
    
    return {
      action: 'ADD',
      items: nextState.itens,
      pending: null,
      errors: [],
      nextState,
      response: `Produto resolvido com ID ${id}.`
    };
  }

  // 4. Tratar "101" solto sem ambiguidade
  if (/^\d+$/.test(clean) && !state.pendingAmbiguity) {
    return {
      action: 'NONE',
      items: state.itens,
      pending: null,
      errors: [],
      nextState: state,
      response: ''
    };
  }

  // 5. Tratar alteração de quantidade "muda a qtd do mobi pra 10k" ou "muda a quantidade do mobi para 10.000"
  const isBudgetChange = /\b(muda|altera|troca|atualiza)\b/i.test(clean);
  if (isBudgetChange && state.itens.length > 0) {
    const numMatch = clean.match(/\b(\d+(?:\.\d+)?)\s*([kk]?)\b/i);
    if (numMatch) {
      let qtd = parseFloat(numMatch[1].replace(/\./g, '')); // 10.000 -> 10000
      if (numMatch[1].includes('.') && numMatch[1].split('.')[1].length !== 3) {
        qtd = parseFloat(numMatch[1]);
      }
      if (numMatch[2].toLowerCase() === 'k') qtd *= 1000;

      const words = clean.split(/\s+/);
      let targetIdx = -1;
      for (let i = 0; i < state.itens.length; i++) {
        if (words.some(w => w.length > 2 && state.itens[i].termo.includes(w))) {
          targetIdx = i;
          break;
        }
      }

      if (targetIdx !== -1) {
        nextState.itens[targetIdx] = { ...nextState.itens[targetIdx], quantidade: qtd };
        return {
          action: 'UPDATE_QTD',
          items: nextState.itens,
          pending: null,
          errors: [],
          nextState,
          response: `Quantidade de ${state.itens[targetIdx].termo} alterada para ${qtd}.`
        };
      }
    }
  }

  // 6. Parse genérico de itens (+, e, etc)
  const items = parseOrcamento(clean);
  if (items.length > 0) {
    const isExplicitAddition = /\b(add|inclui(r)?|adiciona(r)?)\b/i.test(clean);
    const hasPlusOrMais = clean.includes('+') || /\bmais\b/i.test(clean);
    
    // Se a query tem a cara de um orçamento completo novo (ex: 10600 mobi + 1500 triband qual valor?)
    const isFullReplace = /\b(qual valor|orcamento|custa|refaz|refazer|tudo|orco)\b/i.test(clean);

    if (state.itens.length > 0 && isFullReplace) {
      // É replace puro mesmo se tiver +, pois está pedindo o valor de tudo
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
      const isAddition = isExplicitAddition || (state.itens.length > 0 && hasPlusOrMais && clean.startsWith('+') || clean.startsWith('mais'));
      nextState.itens = isAddition ? [...state.itens, ...items] : items;
      return {
        action: state.itens.length === 0 ? 'ADD' : (isAddition ? 'ADD' : 'REPLACE'),
        items: nextState.itens,
        pending: null,
        errors: [],
        nextState,
        response: `Adicionado itens: ${items.map(i => i.termo).join(', ')}`
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
        .replace(/\b(pra|para|de|um|uma|unidades|unidade|un|unid|unids|pecas|peca|mim|orcar|orçar|pode|gostaria|queria|valor|preco|preço|cotacao|cotação|orcamento|orçamento|qual|quanto|custa|orco|orça|do\s*produto|produto|id|prod)\b/gi, ' ')
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
