// Sprite de íconos del mockup (se usan con <Icono nombre="layers" />).
export function SpriteIconos() {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
      <symbol id="i-tower" viewBox="0 0 24 24"><path d="M12 3v3M8 21l2-12h4l2 12M7 21h10M9.5 13h5M8.8 17h6.4" /><circle cx="12" cy="7" r="1.2" /><path d="M6.5 4.5a8 8 0 0 0 0 5M17.5 4.5a8 8 0 0 1 0 5" /></symbol>
      <symbol id="i-layers" viewBox="0 0 24 24"><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3 13 9 5 9-5" /></symbol>
      <symbol id="i-flag" viewBox="0 0 24 24"><path d="M5 21V4M5 4h11l-2 4 2 4H5" /></symbol>
      <symbol id="i-box" viewBox="0 0 24 24"><path d="m21 8-9-5-9 5v8l9 5 9-5V8Z" /><path d="m3 8 9 5 9-5M12 13v8" /></symbol>
      <symbol id="i-bot" viewBox="0 0 24 24"><rect x="4" y="8" width="16" height="11" rx="3" /><path d="M12 4v4M9 13h.01M15 13h.01M9.5 16h5" /></symbol>
      <symbol id="i-chart" viewBox="0 0 24 24"><path d="M4 20V4M4 20h16M8 16v-4M12 16V8M16 16v-6" /></symbol>
      <symbol id="i-chat" viewBox="0 0 24 24"><path d="M4 5h16v11H9l-5 4V5Z" /></symbol>
      <symbol id="i-moon" viewBox="0 0 24 24"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z" /></symbol>
      <symbol id="i-truck" viewBox="0 0 24 24"><path d="M3 6h11v10H3zM14 10h4l3 3v3h-7" /><circle cx="7" cy="18" r="1.8" /><circle cx="17" cy="18" r="1.8" /></symbol>
      <symbol id="i-play" viewBox="0 0 24 24"><path d="M7 5v14l12-7L7 5Z" /></symbol>
      <symbol id="i-refresh" viewBox="0 0 24 24"><path d="M20 11a8 8 0 0 0-14.5-4.5L4 8M4 4v4h4M4 13a8 8 0 0 0 14.5 4.5L20 16M20 20v-4h-4" /></symbol>
      <symbol id="i-lock" viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></symbol>
      <symbol id="i-send" viewBox="0 0 24 24"><path d="m4 12 16-8-6 16-2.5-6.5L4 12Z" /></symbol>
      <symbol id="i-check" viewBox="0 0 24 24"><path d="m5 12 4.5 4.5L19 7" /></symbol>
      <symbol id="i-x" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18" /></symbol>
    </svg>
  );
}

export function Icono({ nombre, className = "ic" }: { nombre: string; className?: string }) {
  return (
    <svg className={className} aria-hidden="true">
      <use href={`#i-${nombre}`} />
    </svg>
  );
}
