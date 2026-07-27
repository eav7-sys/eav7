// Codificação CANÔNICA do estado de consenso.
//
// Substitui o `JSON.stringify` que servia de base para as folhas do stateRoot.
// O motivo é simples: `JSON.stringify` não é especificação. Reproduzi-lo em outra
// linguagem exige replicar o comportamento do V8, incluindo:
//
//   • inteiro acima de 2^53 perde precisão em silêncio (9007199254740993 vira
//     ...992) — e `nonce` e `height` são `number` no JS;
//   • 1e21 sai como "1e+21", não como o inteiro por extenso;
//   • -0 vira 0;
//   • surrogate solto vira "\ud800" escapado.
//
// Nenhum desses comportamentos é do JSON: são do JavaScript. Um cliente em Rust
// que usasse `serde_json` produziria outra folha e outro stateRoot — divergência
// de consenso que só apareceria em produção, na primeira conta com nonce grande.
//
// ---------------------------------------------------------------------------
// FORMATO (tag + comprimento + carga; suficiente para reimplementar em uma página)
//
//   0x00  nulo         (sem carga)
//   0x01  falso        (sem carga)
//   0x02  verdadeiro   (sem carga)
//   0x03  inteiro      u32BE(n) + n bytes ASCII em decimal
//   0x04  texto        u32BE(n) + n bytes UTF-8
//   0x05  lista        u32BE(n) + n valores codificados, na ordem
//   0x06  mapa         u32BE(n) + n pares (texto, valor), ORDENADOS por bytes da chave
//
// Propriedades que o formato garante:
//
//   INJETIVO — tag e comprimento tornam a codificação livre de prefixo: nenhuma
//   sequência de valores distintos produz os mesmos bytes. Sem isso, ["ab"] e
//   ["a","b"] poderiam colidir depois de concatenados, e uma folha do stateRoot
//   seria forjável.
//
//   DETERMINÍSTICO — chaves ordenadas por byte (que em UTF-8 coincide com ordem de
//   ponto de código), inteiro em forma canônica única, sem espaço em branco.
//
//   SEM FLOAT — ponto flutuante NÃO tem tag e é rejeitado. Estado de consenso não
//   tem float hoje, e o formato passa a impedir que ganhe: dois nós com bibliotecas
//   matemáticas diferentes arredondariam diferente e divergiriam.
//
// Comprimento em u32 big-endian, não varint: 4 bytes a mais por campo não custam
// nada num valor que só vai ser hasheado, e a especificação fica sem casos de borda.

const TAG_NULL = 0x00;
const TAG_FALSE = 0x01;
const TAG_TRUE = 0x02;
const TAG_INT = 0x03;
const TAG_STR = 0x04;
const TAG_LIST = 0x05;
const TAG_MAP = 0x06;

const MAX_LEN = 0xffff_ffff;

function u32(n) {
  if (!Number.isInteger(n) || n < 0 || n > MAX_LEN) throw new Error(`comprimento fora da faixa: ${n}`);
  const b = Buffer.allocUnsafe(4);
  b.writeUInt32BE(n, 0);
  return b;
}

// Forma canônica de um inteiro: decimal, sem zero à esquerda, sem "-0", sem "+".
// `BigInt.prototype.toString` já produz exatamente isso.
function intBytes(value) {
  let big;
  if (typeof value === 'bigint') {
    big = value;
  } else if (typeof value === 'number') {
    if (!Number.isInteger(value)) throw new Error(`número não inteiro no estado de consenso: ${value}`);
    // `Object.is(-0, 0)` é falso: normalizamos aqui para -0 e 0 codificarem igual,
    // já que são o mesmo valor matemático.
    big = BigInt(Object.is(value, -0) ? 0 : value);
  } else {
    throw new Error('valor inteiro inválido');
  }
  return Buffer.from(big.toString(), 'ascii');
}

/**
 * Codifica um valor na forma canônica. Lança em qualquer coisa que não caiba no
 * formato — falhar alto é melhor que gravar uma folha que outro cliente não
 * reproduz.
 */
export function encodeCanonical(value) {
  if (value === null || value === undefined) return Buffer.from([TAG_NULL]);

  if (typeof value === 'boolean') return Buffer.from([value ? TAG_TRUE : TAG_FALSE]);

  if (typeof value === 'bigint' || typeof value === 'number') {
    const body = intBytes(value);
    return Buffer.concat([Buffer.from([TAG_INT]), u32(body.length), body]);
  }

  if (typeof value === 'string') {
    const body = Buffer.from(value, 'utf8');
    return Buffer.concat([Buffer.from([TAG_STR]), u32(body.length), body]);
  }

  if (Array.isArray(value)) {
    const itens = value.map(encodeCanonical);
    return Buffer.concat([Buffer.from([TAG_LIST]), u32(itens.length), ...itens]);
  }

  if (typeof value === 'object') {
    // `undefined` é omitido, não codificado como nulo: é o comportamento que a
    // versão com JSON.stringify tinha, e mantê-lo evita que campos opcionais
    // adicionados no futuro mudem a folha de estados antigos.
    const chaves = Object.keys(value).filter((k) => value[k] !== undefined);
    // Ordenação por BYTES da chave. Em UTF-8 isso coincide com ordem de ponto de
    // código — e é reproduzível em qualquer linguagem, ao contrário de
    // `localeCompare` ou da ordem de inserção de objeto.
    chaves.sort((a, b) => (Buffer.from(a, 'utf8').compare(Buffer.from(b, 'utf8'))));
    const partes = [Buffer.from([TAG_MAP]), u32(chaves.length)];
    for (const k of chaves) {
      partes.push(encodeCanonical(k), encodeCanonical(value[k]));
    }
    return Buffer.concat(partes);
  }

  throw new Error(`tipo não codificável no estado de consenso: ${typeof value}`);
}

/** Conveniência: a forma canônica em hexadecimal, para depuração e vetores. */
export const canonicalHex = (value) => encodeCanonical(value).toString('hex');
