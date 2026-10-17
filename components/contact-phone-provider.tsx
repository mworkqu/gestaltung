"use client";

// Hands the contact number (loaded once on the server in app/[locale]/layout.tsx)
// to client components. Without a provider the hook returns the default, so a
// component rendered outside the locale layout still has a working link.

import { createContext, useContext } from "react";

import { DEFAULT_CONTACT_PHONE, type ContactPhone } from "@/lib/contact-phone";

const Ctx = createContext<ContactPhone>(DEFAULT_CONTACT_PHONE);

export function ContactPhoneProvider({ phone, children }: { phone: ContactPhone; children: React.ReactNode }) {
  return <Ctx.Provider value={phone}>{children}</Ctx.Provider>;
}

export function useContactPhone(): ContactPhone {
  return useContext(Ctx);
}
