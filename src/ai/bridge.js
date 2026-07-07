// Ponte de IA do protocolo eav20 — builders das transações que ligam a rede
// EAV7 a agentes de inteligência artificial.
//
// Fluxo on-chain:
//   1. AI_TASK        — usuário escrowa a recompensa e publica o prompt
//   2. ORACLE_REGISTER — operador stakea EAV7 para atuar como oráculo de IA
//   3. AI_RESULT      — oráculo entrega o output; a hash E7 do resultado fica
//                       gravada on-chain e a recompensa é liberada para ele
import { buildTransaction } from '../core/transaction.js';

export function buildAiTaskTx(wallet, { prompt, oracle, model = null, params = null, reward, nonce, timestamp }) {
  return buildTransaction(wallet, {
    type: 'AI_TASK',
    amount: reward,
    nonce,
    timestamp,
    data: { prompt, oracle, model, params },
  });
}

// Reembolso do escrow ao solicitante após o prazo da tarefa.
export function buildAiRefundTx(wallet, { taskId, nonce, timestamp }) {
  return buildTransaction(wallet, {
    type: 'AI_REFUND',
    nonce,
    timestamp,
    data: { taskId },
  });
}

// Confirmação on-chain de que um BRIDGE_OUT foi pago na cadeia externa.
export function buildBridgeSettleTx(wallet, { transferId, externalTxHash = null, nonce, timestamp }) {
  return buildTransaction(wallet, {
    type: 'BRIDGE_SETTLE',
    nonce,
    timestamp,
    data: { transferId, externalTxHash },
  });
}

export function buildOracleRegisterTx(wallet, { stake, endpoint = null, nonce, timestamp }) {
  return buildTransaction(wallet, {
    type: 'ORACLE_REGISTER',
    amount: stake,
    nonce,
    timestamp,
    data: endpoint ? { endpoint } : {},
  });
}

export function buildAiResultTx(wallet, { taskId, output, nonce, timestamp }) {
  return buildTransaction(wallet, {
    type: 'AI_RESULT',
    nonce,
    timestamp,
    data: { taskId, output },
  });
}
