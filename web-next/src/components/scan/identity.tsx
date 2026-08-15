/**
 * Identidade visual de um endereço/token: cor estável derivada da semente —
 * o mesmo endereço recebe sempre o mesmo tom, o que ajuda a reconhecer
 * repetições ao correr o olho. É DECORAÇÃO (o desenho usa avatares coloridos),
 * não informação — por isso pode ser sintetizada sem violar a regra de não
 * inventar dado.
 *
 * Única fonte do tom: antes havia três cópias (flat em lists/latest, gradiente
 * em detail/shell). O gradiente 135deg é o visual canônico.
 */
export function avatarTone(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 360;
  return `linear-gradient(135deg, hsl(${h} 62% 58%), hsl(${(h + 42) % 360} 56% 40%))`;
}

/** Duas letras para o círculo do token/exchange, como no desenho. */
export const initials = (s: string) =>
  (s || "?").replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase();
