/** Voka's logo (round, purple). Image files: web/public/logo.png, favicon.png, icon-192.png, desktop/assets/icon.png. */
export function Logo({ size = 64, className = '' }: { size?: number; className?: string }) {
  return <img className={`logo ${className}`} src="./logo.png" width={size} height={size} alt="Voka" draggable={false} />;
}
