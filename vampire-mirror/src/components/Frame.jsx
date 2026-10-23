// Ornate frame around the glass: dark carved border, a thin gilt line, filigree in each corner.
export default function Frame() {
  return (
    <div className="frame" aria-hidden="true">
      {['tl', 'tr', 'bl', 'br'].map((c) => (
        <svg key={c} className={`corner ${c}`} viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="1.4">
          <path d="M3 61V20Q3 3 20 3H61" />
          <path d="M11 61V24Q11 11 24 11H61" opacity=".55" />
          <path d="M20 20q9 0 9 9q-9 0-9-9z" fill="currentColor" stroke="none" opacity=".8" />
          <path d="M3 34q7-2 9 4M34 3q-2 7 4 9" opacity=".7" />
          <circle cx="3" cy="3" r="2.4" fill="currentColor" stroke="none" />
        </svg>
      ))}
    </div>
  );
}
