// Live password rules for change-password (same as sign-up: 8+ characters and one number).
// If the auth library exports its own rules, switch to them so the two never drift.

export type PasswordRuleId = "length" | "number";

export const PASSWORD_MIN_LENGTH = 8;

export function checkPassword(password: string): Record<PasswordRuleId, boolean> {
  return {
    length: password.length >= PASSWORD_MIN_LENGTH,
    number: /\d/.test(password),
  };
}

export function isPasswordValid(password: string): boolean {
  const r = checkPassword(password);
  return r.length && r.number;
}
