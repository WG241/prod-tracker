/** Centered W mark with a spinning ring — no card, no caption. */
export function BrandLoader({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="brand-loader" role="status" aria-busy="true" aria-label={label}>
      <span className="brand-loader-mark" aria-hidden="true">
        <svg className="brand-loader-ring" viewBox="0 0 72 72" focusable="false">
          <circle className="brand-loader-track" cx="36" cy="36" r="33" />
          <circle className="brand-loader-arc" cx="36" cy="36" r="33" />
        </svg>
        <span className="brand-loader-core">
          <svg className="brand-loader-letter" viewBox="0 0 48 48" focusable="false">
            <path d="M5.5 12.5h7.4l5.35 19.2L24 15.8l5.75 15.9 5.35-19.2h7.4L33.4 36.8c-.75 2.15-2.35 3.45-4.55 3.45-2.05 0-3.55-1.05-4.3-2.9L24 25.2l-.55 1.05-2.75 11.1c-.75 1.85-2.25 2.9-4.3 2.9-2.2 0-3.8-1.3-4.55-3.45Z" />
          </svg>
        </span>
      </span>
      <span className="sr-only">{label}</span>
    </div>
  )
}
