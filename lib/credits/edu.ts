// Educational email rule (mirrors public.is_edu_email in migration 0074 —
// keep the two lists identical). Pure.
//
// Educational = the domain
//   - ends with ".edu"                          cmu.edu, qatar.cmu.edu
//   - or ends with ".edu.<cc>" / ".ac.<cc>"     qu.edu.qa, hbku.edu.qa, udst.edu.qa, ox.ac.uk
// where <cc> is a two-letter country code and at least one label sits before
// "edu"/"ac" (so "edu.qa" and "ac.uk" alone do not count). Subdomains count.

/** What an educational account gets: 1 wiring + 1 cad credit (reason 'edu_grant'). */
export const EDU_CREDITS = { wiring: 1, cad: 1 } as const;

const EDU_RE = /^(?:[a-z0-9-]+\.)+(?:edu|(?:edu|ac)\.[a-z]{2})$/;

export function isEduEmail(email: string | null | undefined): boolean {
  if (typeof email !== "string") return false;
  const e = email.trim().toLowerCase();
  const at = e.lastIndexOf("@");
  if (at < 1 || at !== e.indexOf("@")) return false;
  return EDU_RE.test(e.slice(at + 1));
}

/** The key one grant is recorded under: lowercase, "+tag" dropped from the local part. */
export function eduEmailKey(email: string): string {
  const e = email.trim().toLowerCase();
  const at = e.lastIndexOf("@");
  const local = e.slice(0, at).split("+")[0];
  return `${local}@${e.slice(at + 1)}`;
}
