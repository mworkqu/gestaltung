// "People" — who arrives, who asks, who buys, who leaves. Accounts, leads and
// reviews; the visit counts themselves live in the Traffic section.
//
// Pure: rows in, one Section out.

import {
  breakdown,
  daily,
  delta,
  int,
  inPreviousWindow,
  label,
  money,
  num,
  pct,
  tally,
  toneUp,
  within,
  type Section,
  type Table,
} from "@/lib/mobile/report";

export type ProfileRow = {
  id: string;
  role: string | null;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  locale: string | null;
  created_at: string | null;
};

export type InquiryRow = {
  id: string;
  name: string | null;
  status: string | null;
  locale: string | null;
  project_id: string | null;
  final_quote_qar: number | string | null;
  created_at: string | null;
  is_test: boolean | null;
};

export type ReviewRow = {
  score: number | null;
  status: string | null;
  comment: string | null;
  first_name: string | null;
  created_at: string | null;
};

export type DeletionRow = { created_at: string | null; status: string | null };

export type PeopleInput = {
  profiles: ProfileRow[];
  inquiries: InquiryRow[];
  reviews: ReviewRow[];
  /** Accounts asking to be deleted (CAD Champions keeps the only such table). */
  deletions: DeletionRow[];
  /** Customer names on real orders, for "turned into a customer". */
  buyerKeys: string[];
  windowDays: number;
  now?: number;
};

export function buildPeople(input: PeopleInput): Section {
  const now = input.now ?? Date.now();
  const days = input.windowDays;

  const newNow = input.profiles.filter((p) => within(p.created_at, days, now));
  const newBefore = input.profiles.filter((p) => inPreviousWindow(p.created_at, days, now));

  const realInquiries = input.inquiries.filter((i) => i.is_test !== true);
  const inqNow = realInquiries.filter((i) => within(i.created_at, days, now));
  const inqBefore = realInquiries.filter((i) => inPreviousWindow(i.created_at, days, now));
  const newLeads = realInquiries.filter((i) => i.status === "new");
  const quoted = realInquiries.filter((i) => num(i.final_quote_qar) > 0);

  const buyers = new Set(input.buyerKeys.map((k) => k.trim().toLowerCase()).filter(Boolean));
  const converted = input.profiles.filter((p) => {
    const name = (p.full_name ?? "").trim().toLowerCase();
    return name && buyers.has(name);
  });

  const scored = input.reviews.filter((r) => typeof r.score === "number");
  const avgScore = scored.length ? scored.reduce((s, r) => s + (r.score ?? 0), 0) / scored.length : null;
  const pendingReviews = input.reviews.filter((r) => r.status === "pending" || r.status === "new");

  const leavingNow = input.deletions.filter((d) => within(d.created_at, days, now));

  const withPhone = input.profiles.filter((p) => (p.phone ?? "").trim().length > 0);

  const tiles = [
    {
      label: "New accounts",
      value: int(newNow.length),
      delta: delta(newNow.length, newBefore.length),
      tone: toneUp(newNow.length, newBefore.length),
      hint: `last ${days} days`,
    },
    { label: "Accounts in all", value: int(input.profiles.length) },
    {
      label: "Enquiries",
      value: int(inqNow.length),
      delta: delta(inqNow.length, inqBefore.length),
      tone: toneUp(inqNow.length, inqBefore.length),
      hint: `last ${days} days`,
    },
    {
      label: "Leads unanswered",
      value: int(newLeads.length),
      tone: newLeads.length ? ("warn" as const) : ("good" as const),
      hint: 'still marked "new"',
    },
    {
      label: "Became customers",
      value: int(converted.length),
      hint: input.profiles.length ? `${pct(converted.length, input.profiles.length)} of accounts` : undefined,
    },
    {
      label: "Review score",
      value: avgScore === null ? "—" : `${Math.round(avgScore * 10) / 10} / 5`,
      tone: avgScore === null ? ("flat" as const) : avgScore >= 4 ? ("good" as const) : ("warn" as const),
      hint: `${int(scored.length)} review${scored.length === 1 ? "" : "s"}`,
    },
    {
      label: "Reviews to moderate",
      value: int(pendingReviews.length),
      tone: pendingReviews.length ? ("warn" as const) : ("good" as const),
    },
    {
      label: "Asked to be deleted",
      value: int(leavingNow.length),
      tone: leavingNow.length ? ("bad" as const) : ("good" as const),
      hint: `last ${days} days`,
    },
  ];

  const tables: Table[] = [
    {
      title: "Latest enquiries",
      columns: ["Name", "Status", "Day"],
      rows: [...inqNow]
        .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""))
        .slice(0, 12)
        .map((i) => [i.name ?? "—", label(i.status), (i.created_at ?? "").slice(0, 10)]),
      align: ["l", "l", "l"],
      empty: `No enquiries in the last ${days} days.`,
    },
    breakdown("Enquiries by status", tally(realInquiries, (i) => label(i.status)), ["Status", "Enquiries"]),
    breakdown("Language they chose", tally(input.profiles, (p) => p.locale), ["Locale", "Accounts"], "No locale recorded."),
    breakdown("Account roles", tally(input.profiles, (p) => label(p.role)), ["Role", "Accounts"]),
    {
      title: "Latest reviews",
      columns: ["Who", "Score", "What they said"],
      rows: [...input.reviews]
        .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""))
        .slice(0, 8)
        .map((r) => [r.first_name ?? "—", r.score === null ? "—" : `${r.score}`, (r.comment ?? "").slice(0, 70)]),
      align: ["l", "r", "l"],
      empty: "No reviews yet.",
    },
    {
      title: "Quoted work",
      columns: ["Who", "Quote QAR"],
      rows: [...quoted]
        .sort((a, b) => num(b.final_quote_qar) - num(a.final_quote_qar))
        .slice(0, 10)
        .map((i) => [i.name ?? "—", money(num(i.final_quote_qar))]),
      align: ["l", "r"],
      empty: "Nothing quoted yet.",
    },
  ];

  const notes: string[] = [];
  if (newLeads.length) notes.push(`${newLeads.length} enquir${newLeads.length === 1 ? "y has" : "ies have"} not been answered.`);
  if (pendingReviews.length) notes.push(`${pendingReviews.length} review${pendingReviews.length === 1 ? "" : "s"} waiting to be moderated.`);
  if (leavingNow.length) notes.push(`${leavingNow.length} account${leavingNow.length === 1 ? "" : "s"} asked to be deleted in this window.`);
  if (avgScore !== null && avgScore < 4) notes.push(`The review average is ${Math.round(avgScore * 10) / 10} out of 5.`);
  if (input.profiles.length) notes.push(`${pct(withPhone.length, input.profiles.length)} of accounts left a phone number.`);
  if (!notes.length) notes.push("Every enquiry answered and no reviews waiting.");

  return {
    key: "people",
    title: "People",
    symbol: "person.2",
    blurb: "Who arrives, who asks, who buys, who leaves.",
    tiles,
    series: [
      { title: "New accounts a day", kind: "bar", points: daily(newNow.map((p) => ({ at: p.created_at })), days, now) },
      { title: "Enquiries a day", kind: "bar", points: daily(inqNow.map((i) => ({ at: i.created_at })), days, now) },
    ],
    tables,
    notes,
  };
}
