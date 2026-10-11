import { describe, expect, it } from "vitest";
import { eduEmailKey, isEduEmail } from "./edu";

describe("isEduEmail", () => {
  it.each([
    "a@mit.edu",
    "a@qatar.cmu.edu",
    "a@qu.edu.qa",
    "a@hbku.edu.qa",
    "a@udst.edu.qa",
    "a@ox.ac.uk",
    "a@cs.ox.ac.uk",
    "A@QU.EDU.QA",
    " a@monash.edu.au ",
  ])("accepts %s", (e) => expect(isEduEmail(e)).toBe(true));

  it.each([
    "a@gmail.com",
    "a@edu.qa",
    "a@ac.uk",
    "a@edu",
    "a@education.com",
    "a@myedu.com",
    "a@qu.edu.qa.evil.com",
    "a@qu.edu.com",
    "a@ox.ac.uka",
    "a@x.edu.q",
    "a@b@c.edu",
    "@mit.edu",
    "mit.edu",
    "",
    null,
    undefined,
  ])("rejects %s", (e) => expect(isEduEmail(e as string)).toBe(false));
});

describe("eduEmailKey", () => {
  it("lowercases and drops +tags", () => {
    expect(eduEmailKey("Sara+one@QU.edu.qa")).toBe("sara@qu.edu.qa");
    expect(eduEmailKey("sara@qu.edu.qa")).toBe("sara@qu.edu.qa");
  });
});
