/** Vesper, el anfitrión sin rostro: donde debería estar la cara hay un campo de estrellas. */
export function Vesper({ mood }: { mood: 'idle' | 'nod' | 'open' }) {
  const stars: [number, number, number][] = [[18, 14, 0.9], [25, 11, 0.6], [22, 19, 0.7], [28, 17, 0.5], [16, 20, 0.5], [21, 8, 0.4]];
  return (
    <svg className={`vesper ${mood === 'idle' ? '' : mood}`} viewBox="0 0 44 54" aria-hidden="true">
      <defs>
        <radialGradient id="vv-face" cx="50%" cy="40%" r="60%">
          <stop offset="0" stopColor="#1a0b24" />
          <stop offset="1" stopColor="#030205" />
        </radialGradient>
      </defs>
      <path d="M4 54c1-14 7-21 18-21s17 7 18 21z" fill="#4a0e1e" stroke="#b8934a" strokeWidth="0.8" />
      <path d="M17 33l5 9 5-9" fill="none" stroke="#b8934a" strokeWidth="0.8" />
      <ellipse cx="22" cy="15" rx="10" ry="12" fill="url(#vv-face)" stroke="#6e5a33" strokeWidth="0.8" />
      {stars.map(([x, y, r], i) => (
        <circle key={i} className="star" cx={x} cy={y} r={r} fill="#f4e9d0" />
      ))}
      <g className="hands">
        <ellipse cx="12" cy="48" rx="3.5" ry="2.5" fill="#b8934a" />
        <ellipse cx="32" cy="48" rx="3.5" ry="2.5" fill="#b8934a" />
      </g>
    </svg>
  );
}
