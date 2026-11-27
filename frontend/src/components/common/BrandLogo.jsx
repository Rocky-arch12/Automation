export function BrandLogo({ title = 'AlphaSignal AI', tagline = 'Autonomous MT5 Engine', onClick }) {
  return (
    <div
      className="brand-area"
      style={{ cursor: onClick ? 'pointer' : 'default' }}
      onClick={onClick}
    >
      <div className="brand-logo" aria-hidden="true">
        α
      </div>
      <div className="brand-info">
        <h1 className="brand-title">{title}</h1>
        <p className="brand-tagline">{tagline}</p>
      </div>
    </div>
  );
}
