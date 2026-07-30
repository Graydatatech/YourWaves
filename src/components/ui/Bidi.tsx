import type { ElementType, ReactNode } from "react";

type BidiProps = {
  children: ReactNode;
  /** Element to render as. Defaults to a neutral inline span. */
  as?: ElementType;
  className?: string;
};

/**
 * Isolates a run of mixed-direction content from the text around it.
 *
 * Numbers, prices, phone numbers, dates, times and Latin identifiers must not
 * be reordered by neighbouring Arabic — a phone number renders with its country
 * code stranded on the wrong end, and a currency amount flips. `unicode-bidi:
 * isolate` is what prevents that, and it is the half that matters.
 *
 * THE DIRECTION IS `auto`, NOT `ltr`, and that distinction is load-bearing.
 * `ltr` was right for a pure Latin run like `QAR 5,450` or `YW-2026-0001`, but
 * these values are not all Latin: `45 كم/س` and `١٠ ساعات` carry an Arabic
 * unit, and forcing LTR put the unit where an Arabic reader's eye lands first,
 * so the hero read "km/h 45". `auto` resolves from the first strong character,
 * which gets both families right with one rule:
 *
 *   "QAR 5,450"        → first strong is Latin        → LTR
 *   "+974 5512 3456"   → no strong character at all   → LTR (the fallback)
 *   "45 كم/س"          → first strong is Arabic       → RTL, number read first
 *   "الخميس، 30 يوليو"  → first strong is Arabic       → RTL
 *
 * Isolation still applies in every case, so the run cannot be reordered by the
 * sentence around it either way.
 */
export function Bidi({ children, as: Tag = "span", className }: BidiProps) {
  return (
    <Tag
      dir="auto"
      className={["inline-block [unicode-bidi:isolate]", className]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </Tag>
  );
}
