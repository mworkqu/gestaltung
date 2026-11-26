import { describe, expect, it } from "vitest";

import { afterPage, cadenceDays, chooseStep, droppedOffers, EMPTY_PLAN, isDue, parsePlanState, type PlanOffer, type PlanState } from "./voltaat-plan";

const now = new Date("2026-11-26T12:00:00Z");
const HOUR = 3600_000;
const DAY = 24 * HOUR;
const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();
const offer = (id: string, lastSeenAt: string | null, cadence: 1 | 3 | 7 = 7): PlanOffer => ({ id, hasHandle: true, lastSeenAt, cadence });
const page = (ids: string[], readAt: string, prevReadAt: string | null = null, count = 250) => ({ readAt, prevReadAt, count, offerIds: ids });
const state = (over: Partial<PlanState> = {}): PlanState => ({ ...EMPTY_PLAN, robotsOkAt: ago(DAY), pages: {}, ...over });

describe("cadenceDays / isDue", () => {
  it("paces an item by how often it changed", () => {
    expect([0, 1, 2, 3, 9].map(cadenceDays)).toEqual([7, 3, 3, 1, 1]);
  });
  it("a never-read item is due; others when their pace has passed (4 h early)", () => {
    expect(isDue(offer("a", null), now)).toBe(true);
    expect(isDue(offer("a", ago(6 * DAY)), now)).toBe(false);
    expect(isDue(offer("a", ago(7 * DAY - 3 * HOUR)), now)).toBe(true);
    expect(isDue(offer("a", ago(19 * HOUR), 1), now)).toBe(false);
    expect(isDue(offer("a", ago(21 * HOUR), 1), now)).toBe(true);
    expect(isDue({ ...offer("a", null), hasHandle: false }, now)).toBe(false);
  });
});

describe("chooseStep", () => {
  it("reads robots.txt first, then only once a week", () => {
    expect(chooseStep(EMPTY_PLAN, [offer("a", null)], now)).toEqual({ kind: "robots" });
    expect(chooseStep(state({ robotsOkAt: ago(8 * DAY) }), [offer("a", null)], now)).toEqual({ kind: "robots" });
    expect(chooseStep(state({ robotsOkAt: ago(6 * DAY) }), [offer("a", null)], now)).toMatchObject({ kind: "page" });
  });
  it("goes to a page it has never read when that is where the unread items must be", () => {
    const s = state({ pages: { "1": page(["a"], ago(HOUR)), "2": page(["b"], ago(2 * HOUR)) } });
    const offers = [offer("a", ago(HOUR)), offer("b", ago(2 * HOUR)), offer("never1", null), offer("never2", null)];
    expect(chooseStep(s, offers, now)).toEqual({ kind: "page", page: 3, due: 2, known: false });
  });
  it("does not ask again for a page whose items were all just read", () => {
    const s = state({ lastPage: 2, pages: { "1": page(["a"], ago(HOUR)), "2": page(["b"], ago(2 * HOUR), null, 40) } });
    expect(chooseStep(s, [offer("a", ago(HOUR)), offer("b", ago(2 * HOUR), 1)], now)).toEqual({ kind: "skip", reason: "nothing_due" });
  });
  it("picks the page with the most due items: a busy page daily, a quiet page weekly", () => {
    const s = state({ lastPage: 2, pages: { "1": page(["q1", "q2"], ago(2 * DAY)), "2": page(["hot1", "hot2", "warm"], ago(2 * DAY), null, 40) } });
    const offers = [offer("q1", ago(2 * DAY)), offer("q2", ago(2 * DAY)), offer("hot1", ago(2 * DAY), 1), offer("hot2", ago(2 * DAY), 1), offer("warm", ago(2 * DAY), 3)];
    expect(chooseStep(s, offers, now)).toEqual({ kind: "page", page: 2, due: 2, known: true });
    // A week on, the quiet page is due too.
    const later = new Date(now.getTime() + 5 * DAY);
    const afterHot = { ...s, pages: { ...s.pages, "2": page(["hot1", "hot2", "warm"], later.toISOString(), null, 40) } };
    const fresh = offers.map((o) => (o.id.startsWith("q") ? o : { ...o, lastSeenAt: later.toISOString() }));
    expect(chooseStep(afterHot, fresh, later)).toEqual({ kind: "page", page: 1, due: 2, known: true });
  });
  it("looks for an item that moved only on pages not read since it was last seen", () => {
    // "moved" was on page 1 yesterday; page 1 was re-read an hour ago without it. Page 2 is older.
    const s = state({ lastPage: 2, pages: { "1": page(["a"], ago(HOUR)), "2": page(["b"], ago(2 * DAY), null, 40) } });
    const offers = [offer("a", ago(HOUR)), offer("b", ago(2 * DAY)), offer("moved", ago(DAY), 1)];
    expect(chooseStep(s, offers, now)).toEqual({ kind: "page", page: 2, due: 1, known: true });
  });
  it("never leaves a page unread for more than a week", () => {
    const s = state({ lastPage: 1, pages: { "1": page([], ago(8 * DAY), null, 40) } });
    expect(chooseStep(s, [], now)).toMatchObject({ kind: "page", page: 1 });
  });
  it("'Run now' reads the best page even when nothing is due", () => {
    const s = state({ lastPage: 1, pages: { "1": page(["a"], ago(HOUR), null, 40) } });
    expect(chooseStep(s, [offer("a", ago(HOUR))], now)).toEqual({ kind: "skip", reason: "nothing_due" });
    expect(chooseStep(s, [offer("a", ago(HOUR))], now, true)).toMatchObject({ kind: "page", page: 1 });
  });
});

describe("afterPage", () => {
  it("remembers what the page held and when; a short page is the end", () => {
    const s1 = afterPage(state(), 1, 250, ["a", "b"], 250, now);
    expect(s1.pages["1"]).toEqual({ readAt: now.toISOString(), prevReadAt: null, count: 250, offerIds: ["a", "b"] });
    expect(s1.lastPage).toBeNull();
    const s2 = afterPage(s1, 2, 40, ["c"], 250, now);
    expect(s2.lastPage).toBe(2);
    const again = afterPage(s2, 1, 250, ["a"], 250, new Date(now.getTime() + DAY));
    expect(again.pages["1"]).toMatchObject({ prevReadAt: now.toISOString(), offerIds: ["a"] });
  });
  it("copes with the catalogue growing or shrinking", () => {
    const two = afterPage(afterPage(state(), 1, 250, [], 250, now), 2, 40, [], 250, now);
    // Page 2 is full now: the end is unknown again, so page 3 gets explored.
    expect(afterPage(two, 2, 250, [], 250, now).lastPage).toBeNull();
    // Page 2 came back empty: the catalogue ends on page 1.
    const shrunk = afterPage(two, 2, 0, [], 250, now);
    expect(shrunk.lastPage).toBe(1);
    expect(Object.keys(shrunk.pages)).toEqual(["1"]);
  });
});

describe("droppedOffers", () => {
  const twice = state({ lastPage: 2, pages: { "1": page([], ago(HOUR), ago(2 * DAY)), "2": page([], ago(2 * HOUR), ago(3 * DAY), 40) } });
  it("drops only what every page was read twice without", () => {
    const offers = [offer("old", ago(5 * DAY)), offer("recent", ago(2.5 * DAY)), offer("never", null), { ...offer("no-link", null), hasHandle: false }];
    expect(droppedOffers(offers, twice).map((o) => o.id)).toEqual(["old", "never"]);
  });
  it("drops nothing until the end of the catalogue is known and every page was read twice", () => {
    expect(droppedOffers([offer("old", ago(30 * DAY))], { ...twice, lastPage: null })).toEqual([]);
    const once = { ...twice, pages: { ...twice.pages, "2": page([], ago(HOUR), null, 40) } };
    expect(droppedOffers([offer("old", ago(30 * DAY))], once)).toEqual([]);
  });
});

describe("parsePlanState", () => {
  it("round-trips and throws away anything malformed", () => {
    const s = state({ lastPage: 2, pages: { "1": page(["a"], ago(HOUR)) } });
    expect(parsePlanState(JSON.parse(JSON.stringify(s)))).toEqual(s);
    expect(parsePlanState(null)).toEqual(EMPTY_PLAN);
    expect(parsePlanState({ pages: { x: {}, "2": { readAt: "nope" } }, lastPage: -1 })).toEqual(EMPTY_PLAN);
  });
});
