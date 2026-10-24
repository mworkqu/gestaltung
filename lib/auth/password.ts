// The password rules, in one place so sign-up, reset (client and server action)
// cannot drift apart. Pure: imported by client forms and server actions alike.
//
// Sign-in deliberately does NOT use the minimum: accounts made when it was 6
// must still be able to sign in and then reset to a stronger one.

/** F-031: raised from 6. Supabase's own "Minimum password length" (dashboard) must match. */
export const MIN_PASSWORD_LENGTH = 8;

/** bcrypt stops reading at 72 bytes. */
export const MAX_PASSWORD_LENGTH = 72;
