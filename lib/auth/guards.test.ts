import { beforeEach, describe, expect, it, vi } from "vitest";

// WEB-02 / WEB-08: admin pages must redirect non-admins themselves, before any
// service-role read, because Next can render a page without its layouts.

class RedirectSentinel extends Error {
  constructor(public readonly url: string) {
    super(`NEXT_REDIRECT ${url}`);
  }
}

const mocks = vi.hoisted(() => ({
  getAuthUser: vi.fn(),
  getSessionContext: vi.fn(),
  createServiceClient: vi.fn(() => null),
  createClient: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new RedirectSentinel(url);
  },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("@/lib/auth/get-session", () => ({
  getAuthUser: mocks.getAuthUser,
  getSessionContext: mocks.getSessionContext,
}));
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: mocks.createServiceClient }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("next-intl/server", () => ({
  setRequestLocale: vi.fn(),
  getTranslations: vi.fn(async () => (key: string) => key),
}));
vi.mock("@/i18n/navigation", () => ({ Link: () => null }));

import { requireSignedIn, requireSuperAdmin } from "@/lib/auth/guards";

const UID = "11111111-1111-4111-8111-111111111111";
const member = { id: UID, email: "a@example.com", is_anonymous: false };
const guest = { id: UID, email: "", is_anonymous: true };
const sessionWithRole = (role: string) => ({
  email: "a@example.com",
  profile: { id: UID, role, tenant_id: null, full_name: null, phone: null, locale: "en", created_at: "" },
  tenant: null,
});

async function redirectOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof RedirectSentinel) return e.url;
    throw e;
  }
  throw new Error("expected a redirect");
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("requireSuperAdmin", () => {
  it("sends a signed-out visitor to sign-in", async () => {
    mocks.getAuthUser.mockResolvedValue(null);
    mocks.getSessionContext.mockResolvedValue(null);
    expect(await redirectOf(requireSuperAdmin("en"))).toBe("/en/sign-in");
  });

  it("sends a guest (anonymous session) to their projects, like the dashboard layout", async () => {
    mocks.getAuthUser.mockResolvedValue(guest);
    mocks.getSessionContext.mockResolvedValue(sessionWithRole("client"));
    expect(await redirectOf(requireSuperAdmin("ar"))).toBe("/ar/projects");
    expect(mocks.getSessionContext).not.toHaveBeenCalled();
  });

  it("sends a signed-in client or workshop back to the dashboard", async () => {
    mocks.getAuthUser.mockResolvedValue(member);
    mocks.getSessionContext.mockResolvedValue(sessionWithRole("client"));
    expect(await redirectOf(requireSuperAdmin("en"))).toBe("/en/dashboard");
    mocks.getSessionContext.mockResolvedValue(sessionWithRole("workshop"));
    expect(await redirectOf(requireSuperAdmin("en"))).toBe("/en/dashboard");
  });

  it("returns the session for a super_admin and reuses the already-read user", async () => {
    const session = sessionWithRole("super_admin");
    mocks.getAuthUser.mockResolvedValue(member);
    mocks.getSessionContext.mockResolvedValue(session);
    await expect(requireSuperAdmin("en")).resolves.toBe(session);
    expect(mocks.getSessionContext).toHaveBeenCalledWith(member);
  });
});

describe("requireSignedIn", () => {
  it("returns the session for any signed-in role", async () => {
    const session = sessionWithRole("client");
    mocks.getAuthUser.mockResolvedValue(member);
    mocks.getSessionContext.mockResolvedValue(session);
    await expect(requireSignedIn("en")).resolves.toBe(session);
  });

  it("sends a user without a profile to sign-in", async () => {
    mocks.getAuthUser.mockResolvedValue(member);
    mocks.getSessionContext.mockResolvedValue(null);
    expect(await redirectOf(requireSignedIn("en"))).toBe("/en/sign-in");
  });
});

describe("dashboard/customers/[id] page (WEB-02)", () => {
  it("redirects a client before any Supabase read, service-role or not", async () => {
    mocks.getAuthUser.mockResolvedValue(member);
    mocks.getSessionContext.mockResolvedValue(sessionWithRole("client"));
    const { default: CustomerPage } = await import("@/app/[locale]/dashboard/customers/[id]/page");
    const url = await redirectOf(CustomerPage({ params: Promise.resolve({ locale: "en", id: UID }) }));
    expect(url).toBe("/en/dashboard");
    expect(mocks.createServiceClient).not.toHaveBeenCalled();
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("redirects a signed-out request to sign-in without touching the service client", async () => {
    mocks.getAuthUser.mockResolvedValue(null);
    mocks.getSessionContext.mockResolvedValue(null);
    const { default: CustomerPage } = await import("@/app/[locale]/dashboard/customers/[id]/page");
    const url = await redirectOf(CustomerPage({ params: Promise.resolve({ locale: "en", id: UID }) }));
    expect(url).toBe("/en/sign-in");
    expect(mocks.createServiceClient).not.toHaveBeenCalled();
  });
});
