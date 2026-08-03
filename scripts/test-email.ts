// Unit tests for the spoken-email parser. No network, no API keys.
//
//   npm run test:email
//   npm run test:email -- --speak    print read-back strings to ear-check on a voice
//
// The cases marked GOLDEN come verbatim from the call that prompted this
// module (Vapi 019fb8dc-9035-7bb6-9ae0-cdd1d758473e), where Scarlett booked
// mattmanzi@gmail.com for mattmanzijr@gmail.com.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseSpokenEmail,
  spellbackFor,
  correctDomain,
  isValidEmail,
} from "../lib/email/spoken";

interface Case {
  input: string;
  email?: string;
  valid?: boolean;
  corrected?: [string, string];
  alternatives?: string;
  note?: string;
}

const CASES: Case[] = [
  // ── GOLDEN: the failure that prompted this ──
  {
    input: "M a t t m a n z I j r at g m a I l dot com",
    email: "mattmanzijr@gmail.com",
    note: "GOLDEN — the address that got booked wrong",
  },
  {
    input: "Matt manzie junior at g mail dot com.",
    email: "mattmanziejunior@gmail.com",
    alternatives: "junior",
    note: "GOLDEN — must flag jr/junior instead of silently picking one",
  },

  {
    input: "Matt Vanzee, j r. At g mail dot com.",
    email: "mattvanzeejr@gmail.com",
    alternatives: "junior",
    note: "GOLDEN — trailing period after a spelled suffix must not break it",
  },
  {
    input: "edjjones07 at gmail dot com",
    email: "edjjones07@gmail.com",
    note: "digits are ordinary — must not raise an ambiguity",
  },

  // ── NATO gating: the trap that turns a name into a single letter ──
  { input: "mike at gmail dot com", email: "mike@gmail.com", note: "must NOT be m@gmail.com" },
  { input: "victor at yahoo dot com", email: "victor@yahoo.com" },
  { input: "alpha bravo charlie at gmail dot com", email: "abc@gmail.com" },
  { input: "m i k e at gmail dot com", email: "mike@gmail.com" },

  // ── phonetic spell-outs ──
  { input: "M as in Mary, a, t, t at gmail dot com", email: "matt@gmail.com" },
  { input: "e as in echo, d as in delta at elenos dot ai", email: "ed@elenos.ai" },

  // ── domain correction ──
  { input: "ed at gmale dot com", email: "ed@gmail.com", corrected: ["gmale.com", "gmail.com"] },
  { input: "ed at gmail dot co", email: "ed@gmail.com", corrected: ["gmail.co", "gmail.com"] },
  { input: "ed at hotmial dot com", email: "ed@hotmail.com", corrected: ["hotmial.com", "hotmail.com"] },
  { input: "info at elenos dot ai", email: "info@elenos.ai", note: "real domain, no correction" },
  {
    input: "mike at sullivanelectric dot com",
    email: "mike@sullivanelectric.com",
    note: "company domain survives untouched",
  },

  // ── separators ──
  { input: "john dot smith at yahoo dot com", email: "john.smith@yahoo.com" },
  { input: "john underscore smith at outlook dot com", email: "john_smith@outlook.com" },
  { input: "john dash smith at icloud dot com", email: "john-smith@icloud.com" },
  { input: "matt at symbol gmail dot com", email: "matt@gmail.com" },

  // ── digits ──
  { input: "j o h n oh seven at gmail dot com", email: "john07@gmail.com" },
  { input: "b i double l at gmail dot com", email: "bill@gmail.com" },

  // ── STT artifacts ──
  {
    input: "cheriselyn n1@gmail.com",
    email: "cheriselynn1@gmail.com",
    note: "the stray-space artifact from bookDiscoveryCall.ts:46",
  },
  { input: "it's matt at gmail dot com, all one word", email: "matt@gmail.com" },
  { input: "MATT@GMAIL.COM.", email: "matt@gmail.com" },
  { input: "matt @ gmail.com", email: "matt@gmail.com" },

  // ── must refuse ──
  { input: "sarah at yahoo", valid: false, note: "no TLD — must not book" },
  { input: "uhh I don't know", valid: false },
  { input: "", valid: false },
];

test("parseSpokenEmail", async (t) => {
  for (const c of CASES) {
    const label = c.note ? `${c.input}  (${c.note})` : c.input || "<empty>";
    await t.test(label, () => {
      const got = parseSpokenEmail(c.input);
      if (c.valid === false) {
        assert.equal(got.valid, false, `expected invalid, got ${got.email}`);
        assert.equal(got.spellback, "", "invalid results must not offer a spellback");
        return;
      }
      assert.equal(got.valid, true, `expected valid, got ${JSON.stringify(got)}`);
      assert.equal(got.email, c.email);
      if (c.corrected) {
        assert.deepEqual(got.correctedDomain, { from: c.corrected[0], to: c.corrected[1] });
      }
      if (c.alternatives) {
        const reasons = (got.alternatives ?? []).map((a) => a.reason);
        assert.ok(
          reasons.includes(c.alternatives),
          `expected an "${c.alternatives}" ambiguity, got ${JSON.stringify(reasons)}`,
        );
      }
    });
  }
});

test("spellbackFor", async (t) => {
  const cases: [string, string][] = [
    ["mattmanzijr@gmail.com", "M A T T M A N Z I J R at gmail dot com"],
    ["matt07@gmail.com", "M A T T 0 7 at gmail dot com"],
    ["john.smith@yahoo.com", "J O H N dot S M I T H at yahoo dot com"],
    ["john_smith@outlook.com", "J O H N underscore S M I T H at outlook dot com"],
    [
      "mike@sullivanelectric.com",
      "M I K E at S U L L I V A N E L E C T R I C dot com",
    ],
  ];
  for (const [email, expected] of cases) {
    await t.test(email, () => assert.equal(spellbackFor(email), expected));
  }

  await t.test("never says 'space' or invents phonetics", () => {
    for (const [email] of cases) {
      const out = spellbackFor(email);
      assert.ok(!/\bspace\b/.test(out), `"${out}" contains "space"`);
      assert.ok(!/\bas in\b/.test(out), `"${out}" contains "as in"`);
    }
  });
});

test("correctDomain guards", async (t) => {
  await t.test("exact matches are never touched", () => {
    assert.equal(correctDomain("gmail.com").corrected, undefined);
    assert.equal(correctDomain("me.com").corrected, undefined);
  });
  await t.test("short domains use a tighter edit budget", () => {
    // me.com <-> we.com is one edit, but me.com is short, so a 1-edit match is
    // allowed only when unambiguous. aol.com <-> aon.com likewise.
    const r = correctDomain("nonsensedomain.com");
    assert.equal(r.corrected, undefined);
  });
  await t.test("far-away domains survive", () => {
    assert.equal(correctDomain("sullivanelectric.com").domain, "sullivanelectric.com");
    assert.equal(correctDomain("elenos.ai").domain, "elenos.ai");
  });
});

test("isValidEmail", async (t) => {
  const good = ["a@b.co", "matt@gmail.com", "john.smith@sub.example.com"];
  const bad = ["a@b", "a..b@c.com", ".a@b.com", "a@b..com", "a@@b.com", "no-at-sign.com", ""];
  await t.test("accepts", () => good.forEach((s) => assert.ok(isValidEmail(s), s)));
  await t.test("rejects", () => bad.forEach((s) => assert.ok(!isValidEmail(s), s)));
});

// --speak: print the read-back lines so they can be pasted into Vapi's voice
// preview. If the voice mushes "M A T T" into "matt", change LETTER_JOINER in
// lib/email/spoken.ts to ". " or "-" and listen again.
if (process.argv.includes("--speak")) {
  console.log("\n── read-back lines (paste into Vapi voice preview) ──\n");
  for (const e of [
    "mattmanzijr@gmail.com",
    "edjjones07@gmail.com",
    "john.smith@sullivanelectric.com",
    "matt07@gmail.com",
  ]) {
    console.log(`${e}\n  → "Let me read that back — ${spellbackFor(e)}. Did I get it?"\n`);
  }
}
