/** Voka's brand: the white mascot on purple. Image files: web/public/logo-glyph.png, favicon.png, desktop/assets/icon.png. */
export const BRAND = '#7533fb';

/** The white mascot alone (transparent background). */
export function LogoGlyph({ size = 24 }: { size?: number }) {
  return <img src="./logo-glyph.png" width={size} height={size} alt="" draggable={false} />;
}

/** The full app icon: the mascot on a purple tile. */
export function Logo({ size = 64, className = '' }: { size?: number; className?: string }) {
  return (
    <span className={`logo ${className}`} style={{ width: size, height: size, borderRadius: size * 0.22 }} role="img" aria-label="Voka">
      <LogoGlyph size={size * 0.68} />
    </span>
  );
}
