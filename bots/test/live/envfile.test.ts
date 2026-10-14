import { describe, expect, test } from "bun:test";
import { parseEnvText, setMissing } from "../../src/live/lib/envfile";

describe("env files", () => {
  test("parse KEY=VALUE, skip comments and blanks, strip quotes", () => {
    const m = parseEnvText('# comment\n\nA=1\nB="two"\n  C = 3 \nbroken\n');
    expect([...m.entries()]).toEqual([
      ["A", "1"],
      ["B", "two"],
      ["C", "3"],
    ]);
  });
  test("setMissing appends new keys and keeps existing values", () => {
    const r = setMissing("# keys\nA=1\n", [
      ["A", "9"],
      ["B", "2"],
    ]);
    expect(r.text).toBe("# keys\nA=1\nB=2\n");
    expect(r.added).toEqual(["B"]);
  });
  test("setMissing fills an empty value in place (a copied .env.example)", () => {
    const r = setMissing("A=\nB=x\n", [["A", "1"]]);
    expect(r.text).toBe("A=1\nB=x\n");
    expect(r.added).toEqual(["A"]);
  });
  test("setMissing on an empty file", () => {
    expect(setMissing("", [["A", "1"]]).text).toBe("A=1\n");
  });
});
