import type { CSSProperties, ReactNode } from 'react';
import type { NameStyle, User } from './types';

/** Kept in sync with NAME_FONTS in server/src/routes/auth.ts. Fonts are free (OFL) from @fontsource. */
export const NAME_FONTS: { id: string; label: string }[] = [
  { id: 'default', label: 'Padrão' },
  { id: 'rounded', label: 'Redonda' },
  { id: 'serif', label: 'Elegante' },
  { id: 'mono', label: 'Código' },
  { id: 'pixel', label: 'Pixel' },
  { id: 'script', label: 'Cursiva' },
  { id: 'display', label: 'Impacto' },
  { id: 'future', label: 'Futurista' },
];

/** How many colors each effect uses, and what they are called in the editor. */
export const NAME_EFFECTS: { id: string; label: string; colors: string[] }[] = [
  { id: 'solid', label: 'Sólido', colors: ['Cor'] },
  { id: 'gradient', label: 'Gradiente', colors: ['Início', 'Fim'] },
  { id: 'neon', label: 'Neon', colors: ['Letra', 'Brilho'] },
  { id: 'outline', label: 'Contorno', colors: ['Contorno', 'Letra'] },
];

export const DEFAULT_NAME_STYLE: NameStyle = { font: 'default', effect: 'solid', colors: [] };

/** Class and CSS variables that draw a name in the given style. `fallback` is used when there is no own color (e.g. a role color). */
export function nameStyleProps(style: NameStyle | undefined, fallback?: string): { className: string; style: CSSProperties } {
  const s = style ?? DEFAULT_NAME_STYLE;
  const [c1, c2] = s.colors;
  const effect = s.effect === 'solid' || c1 ? s.effect : 'solid';
  const css: Record<string, string> = {};
  if (effect === 'solid') { if (c1 || fallback) css.color = c1 ?? fallback!; }
  else {
    css['--n1'] = c1;
    css['--n2'] = c2 ?? (effect === 'gradient' ? '#ffffff' : c1);
  }
  return { className: `styled-name font-${s.font} effect-${effect}`, style: css as CSSProperties };
}

/** A user's name drawn with their chosen font, effect and colors. */
export function StyledName({ user, children, fallbackColor, className = '' }: { user: Pick<User, 'nameStyle'>; children: ReactNode; fallbackColor?: string; className?: string }) {
  const p = nameStyleProps(user.nameStyle, fallbackColor);
  return <span className={`${p.className} ${className}`} style={p.style}>{children}</span>;
}

/** Background for a profile in the user's colors, or undefined for the default look. */
export function profileBackground(colors: string[] | undefined) {
  if (!colors?.length) return undefined;
  return colors.length === 1 ? colors[0] : `linear-gradient(180deg, ${colors[0]}, ${colors[1]})`;
}

/** Relative brightness of a #rrggbb color, 0 (black) to 1 (white). */
function luminance(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const ch = [n >> 16, (n >> 8) & 255, n & 255].map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

/** Whether a profile in these colors needs dark text: only when every color is light (text runs over the whole card). */
export function isLightTheme(colors: string[] | undefined) {
  if (!colors?.length) return false;
  return Math.min(...colors.map(luminance)) > 0.4;
}
