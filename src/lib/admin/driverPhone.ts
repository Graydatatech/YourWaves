import parsePhoneNumberFromString from "libphonenumber-js/min";

/**
 * Turns whatever an admin typed into E.164, or null.
 *
 * The settings form shows a fixed `+974` prefix and strips non-digits, so the
 * common case arrives as bare local digits. This still accepts a full
 * international number, because someone will paste one from WhatsApp — and a
 * pasted "+974 5501 0001" must not become "+974974550100001".
 *
 * Validation is libphonenumber's, not a regex: the number is what dispatch
 * messages go to, and "looks like a phone number" is not the same as "can be
 * dialled". Same library and the same standard the customer booking form uses.
 */
export function normaliseDriverPhone(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const candidate = trimmed.startsWith("+")
    ? trimmed
    : `+974${trimmed.replace(/\D/g, "").replace(/^974/, "")}`;

  const parsed = parsePhoneNumberFromString(candidate);
  return parsed?.isValid() ? parsed.number : null;
}
