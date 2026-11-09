/** "Lock" in ink, "In" under a highlighter swipe — the product in one mark. */
export function Wordmark({ small = false }: { small?: boolean }) {
  return (
    <span
      className="inline-flex items-baseline font-display leading-none tracking-[-0.02em] select-none"
      style={{ fontVariationSettings: "'wdth' 118", fontWeight: 600, fontSize: small ? 17 : 22 }}
      aria-label="LockIn"
    >
      <span aria-hidden>Lock</span>
      <span aria-hidden className="hl ml-[0.04em]" style={{ padding: '0 0.12em', margin: 0 }}>
        In
      </span>
    </span>
  );
}
