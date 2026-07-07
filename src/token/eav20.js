import { isAmountString } from '../config.js';

// Padrão de token EAV20 — equivalente ao TRC20 da Tron, nativo do protocolo eav20.
// Tokens vivem no estado da cadeia (sem VM): criados e movidos por transações assinadas.
export const EAV20_STANDARD = Object.freeze({
  name: 'EAV20',
  protocol: 'eav20',
  version: 1,
  methods: ['create', 'transfer', 'approve', 'transferFrom', 'balanceOf', 'allowance', 'totalSupply'],
});

export function validateTokenParams(data) {
  if (!data || typeof data !== 'object') return 'parâmetros do token ausentes';
  const { name, symbol, decimals, totalSupply } = data;
  if (typeof name !== 'string' || name.trim().length < 1 || name.length > 64) {
    return 'nome do token deve ter entre 1 e 64 caracteres';
  }
  if (typeof symbol !== 'string' || !/^[A-Z0-9]{2,10}$/.test(symbol)) {
    return 'símbolo do token deve ter 2 a 10 caracteres [A-Z0-9]';
  }
  if (!Number.isSafeInteger(decimals) || decimals < 0 || decimals > 18) {
    return 'decimais do token devem ser um inteiro entre 0 e 18';
  }
  if (!isAmountString(totalSupply) || BigInt(totalSupply) <= 0n) {
    return 'suprimento total deve ser uma string decimal positiva';
  }
  return null;
}

export function tokenBalanceOf(token, address) {
  return token?.balances?.[address] ?? 0n;
}

export function tokenAllowance(token, owner, spender) {
  return token?.allowances?.[owner]?.[spender] ?? 0n;
}

// Visão pública do token (sem o mapa completo de saldos).
export function tokenView(token) {
  const { balances, allowances, ...info } = token;
  return { ...info, holders: Object.keys(balances).filter((a) => balances[a] > 0n).length };
}
