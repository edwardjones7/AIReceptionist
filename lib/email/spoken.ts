// Deterministic spoken-email parser.
//
// Speech-to-text is bad at email addresses and terrible at dictated letters.
// Rather than ask the model to reconstruct an address from a mangled
// transcript (which it does inconsistently, and which is how we once booked
// "mattmanzi@gmail.com" for mattmanzijr@gmail.com), every address goes through
// this module: one normalizer, one validator, one canonical read-back string.
//
// Pure — no I/O, no dependencies, fully unit-tested in scripts/test-email.ts.

export interface ParsedEmail {
  /** Normalized best effort; "" when nothing usable came through. */
  email: string;
  valid: boolean;
  /** Canonical read-back for the assistant to speak verbatim; "" when !valid. */
  spellback: string;
  /** "low" when we had to guess, or ran out of signal partway. */
  confidence: "high" | "low";
  /** Set when a near-miss domain was auto-corrected. Never applied silently. */
  correctedDomain?: { from: string; to: string };
  /** Genuine ambiguities the caller must resolve with a closed question. */
  alternatives?: { reason: string; candidates: string[] }[];
  /** Exactly what came in, for logging and lead rows. */
  raw: string;
}

/** Domains common enough that a near-miss is far more likely than a real match. */
export const TOP_DOMAINS = [
  "gmail.com",
  "yahoo.com",
  "outlook.com",
  "hotmail.com",
  "icloud.com",
  "aol.com",
  "comcast.net",
  "verizon.net",
  "me.com",
  "live.com",
  "msn.com",
  "protonmail.com",
  "sbcglobal.net",
  "att.net",
  "ymail.com",
] as const;

/** Second-level labels of TOP_DOMAINS — spoken as words in the read-back. */
const TOP_SLDS = new Set(TOP_DOMAINS.map((d) => d.split(".")[0]));

// Bare provider name -> full domain. People say "jim at gmail" and leave the
// TLD implied constantly, and speech-to-text drops a trailing "dot com" just as
// often. Rejecting those outright sent real callers around the re-ask loop
// until the attempt cap gave up on booking them, so complete the obvious ones.
// Only well-known providers: "jimsplumbing" with no TLD is genuinely ambiguous
// (.com? .net?) and must still fail.
// "me" is excluded (too generic a word), and "ymail" because it sits one edit
// from "gmail" — keeping it only creates ties that block gmail typo repair,
// and ymail.com is vanishingly rare by comparison. Both still match in full
// "…dot com" form via the normal domain path.
const BARE_SLD_TO_DOMAIN: Record<string, string> = Object.fromEntries(
  TOP_DOMAINS.filter((d) => d !== "me.com" && d !== "ymail.com").map((d) => [
    d.split(".")[0],
    d,
  ]),
);

// NATO alphabet. Deliberately includes the common misspellings/variants callers
// and Deepgram produce. Only applied in spelling mode — see parseSpokenEmail.
const NATO: Record<string, string> = {
  alpha: "a", alfa: "a",
  bravo: "b",
  charlie: "c",
  delta: "d",
  echo: "e",
  foxtrot: "f",
  golf: "g",
  hotel: "h",
  india: "i",
  juliet: "j", juliett: "j", julliet: "j",
  kilo: "k",
  lima: "l",
  mike: "m",
  november: "n",
  oscar: "o",
  papa: "p", poppa: "p",
  quebec: "q",
  romeo: "r",
  sierra: "s",
  tango: "t",
  uniform: "u",
  victor: "v",
  whiskey: "w", whisky: "w",
  xray: "x",
  yankee: "y",
  zulu: "z",
};

const DIGITS: Record<string, string> = {
  zero: "0", one: "1", two: "2", three: "3", four: "4",
  five: "5", six: "6", seven: "7", eight: "8", nine: "9",
};

// Domain second-level labels that STT reliably splits or mangles.
const DOMAIN_REPAIRS: [RegExp, string][] = [
  [/\bg\s*[-.]?\s*mail\b/g, "gmail"],
  [/\bgee\s*mail\b/g, "gmail"],
  [/\bjimail\b/g, "gmail"],
  [/\bg\s*male\b/g, "gmale"], // keep as a domain word; correctDomain fixes it
  [/\bhot\s*mail\b/g, "hotmail"],
  [/\bi\s*cloud\b/g, "icloud"],
  [/\bout\s*look\b/g, "outlook"],
  [/\by\s*mail\b/g, "ymail"],
  [/\bproton\s*mail\b/g, "protonmail"],
  [/\bs\s*b\s*c\s*global\b/g, "sbcglobal"],
  [/\blive\s*mail\b/g, "live"],
];

const EMAIL_RE =
  /^[a-z0-9](?:[a-z0-9._%+-]{0,62}[a-z0-9])?@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z]{2,24})+$/;

export function isValidEmail(s: string): boolean {
  if (!EMAIL_RE.test(s)) return false;
  const [local] = s.split("@");
  // The regex allows dots in the local part but not these shapes.
  if (local.includes("..") || local.startsWith(".") || local.endsWith(".")) return false;
  if (s.split("@").length !== 2) return false;
  if (s.includes("..")) return false;
  return true;
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  const curr = new Array<number>(n + 1);
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    prev = curr.slice();
  }
  return prev[n];
}

/**
 * Fix a near-miss domain against TOP_DOMAINS, conservatively.
 *
 * Guards, in order: an exact match is never touched; the edit budget is 1 for
 * short targets (me.com, att.net) so we don't turn one real domain into
 * another; and the best candidate must beat the runner-up outright. A genuine
 * company domain (sullivanelectric.com) is far from everything and survives.
 */
export function correctDomain(domain: string): {
  domain: string;
  corrected?: { from: string; to: string };
  ambiguous?: boolean;
} {
  const d = domain.toLowerCase();
  if (!d) return { domain: d };
  if ((TOP_DOMAINS as readonly string[]).includes(d)) return { domain: d };

  // "gmail" -> "gmail.com", "comcast" -> "comcast.net". Surfaced as a
  // correction so the assistant confirms it rather than assuming.
  if (!d.includes(".") && BARE_SLD_TO_DOMAIN[d]) {
    return { domain: BARE_SLD_TO_DOMAIN[d], corrected: { from: d, to: BARE_SLD_TO_DOMAIN[d] } };
  }

  // No TLD and not an exact provider match — try a fuzzy hit on the bare name
  // ("gmale" -> gmail.com) before falling through to full-domain matching.
  if (!d.includes(".")) {
    const slds = Object.keys(BARE_SLD_TO_DOMAIN);
    const ranked = slds.map((s) => ({ s, dist: levenshtein(d, s) })).sort((a, b) => a.dist - b.dist);
    const top = ranked[0];
    const second = ranked[1];
    // Short names (aol, msn, att, live) stay at 1 edit — they're close enough
    // to each other and to ordinary words that 2 would invent matches.
    const budget = top && top.s.length <= 4 ? 1 : 2;
    if (top && top.dist <= budget && (!second || second.dist > top.dist)) {
      const full = BARE_SLD_TO_DOMAIN[top.s];
      return { domain: full, corrected: { from: d, to: full } };
    }
    // Unknown bare name (a company domain) — leave it; validation will reject.
    return { domain: d };
  }

  const scored = TOP_DOMAINS.map((t) => ({ t, dist: levenshtein(d, t) })).sort(
    (a, b) => a.dist - b.dist,
  );
  const best = scored[0];
  const runnerUp = scored[1];
  const budget = best.t.length <= 8 ? 1 : 2;

  if (best.dist > budget) return { domain: d };
  // A tie means we can't tell which one they meant — don't guess.
  if (runnerUp && runnerUp.dist === best.dist) return { domain: d, ambiguous: true };

  return { domain: best.t, corrected: { from: d, to: best.t } };
}

/** Split a raw string into tokens, keeping @ . _ - + as their own tokens. */
function tokenize(s: string): string[] {
  return s
    .replace(/([@._+/-])/g, " $1 ")
    .split(/[\s,]+/)
    .filter(Boolean);
}

/**
 * Turn whatever the caller said into an email address.
 *
 * The steps are ordered: phonetics ("m as in Mary") must resolve before we can
 * count single letters, and we must count single letters before expanding NATO
 * words — otherwise "mike at gmail dot com" becomes m@gmail.com.
 */
export function parseSpokenEmail(raw: string): ParsedEmail {
  const original = String(raw ?? "");
  const fail = (confidence: "high" | "low" = "low"): ParsedEmail => ({
    email: "",
    valid: false,
    spellback: "",
    confidence,
    raw: original,
  });

  let s = original.toLowerCase().trim();
  if (!s) return fail();

  // 1. Shell: quotes and trailing sentence punctuation.
  s = s.replace(/^["'`\s]+|["'`\s]+$/g, "").replace(/[.,;!?]+$/g, "");

  // 2. Conversational lead-ins and trailers.
  s = s.replace(/^(?:it'?s|that'?s|my email is|the email is|email is|sure|okay|ok|yeah|yep|um+|uh+)[\s,]+/g, "");
  s = s.replace(/[\s,]*(?:all one word|all lower ?case|no spaces?|one word|that'?s it)\.?$/g, "");

  // 3. "X as in Y" -> "X". Deepgram hears "as in" as "is in" / "has in" too.
  //    Runs before letter-joining so the phonetic word never becomes a token.
  s = s.replace(/\b([a-z])\s+(?:as|is|has)\s+in\s+[a-z]+\b/g, " $1 ");
  s = s.replace(/\b([a-z])\s+for\s+[a-z]+\b/g, " $1 ");

  // 4. Domain-word repair, before tokenizing (these patterns span spaces).
  for (const [re, to] of DOMAIN_REPAIRS) s = s.replace(re, to);
  s = s.replace(/\bx\s*-?\s*ray\b/g, "xray");
  s = s.replace(/\bat\s+(?:sign|symbol)\b/g, " @ ");
  s = s.replace(/\bat\s+the\s+rate\b/g, " @ ");
  s = s.replace(/\bunder\s*(?:score|bar)\b/g, " _ ");
  s = s.replace(/\b(?:hyphen|dash|minus)\b/g, " - ");
  s = s.replace(/\b(?:dot|period|point|full stop)\b/g, " . ");
  s = s.replace(/\bplus(?:\s+sign)?\b/g, " + ");
  s = s.replace(/\b(?:forward\s+)?slash\b/g, " / ");

  let tokens = tokenize(s);
  if (!tokens.length) return fail();

  // 5. "double l" / "triple x" -> repeated letters.
  const expanded: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const next = tokens[i + 1];
    const reps = t === "double" ? 2 : t === "triple" ? 3 : 0;
    if (reps && next && (next.length === 1 || NATO[next])) {
      const letter = next.length === 1 ? next : NATO[next];
      expanded.push(...Array(reps).fill(letter));
      i++;
      continue;
    }
    expanded.push(t);
  }
  tokens = expanded;

  // 6. Spelling mode: two or more standalone single letters means the caller
  //    is dictating. This gate decides whether NATO words and "oh" are letters
  //    or ordinary words.
  const singleLetters = tokens.filter((t) => /^[a-z]$/.test(t)).length;
  const nataRun = tokens.filter((t) => NATO[t]).length;
  const spellingMode = singleLetters >= 2 || nataRun >= 2;

  tokens = tokens.map((t) => {
    if (spellingMode && NATO[t]) return NATO[t];
    if (DIGITS[t]) return DIGITS[t];
    if (spellingMode && t === "oh") return "0";
    return t;
  });

  // 7. Standalone "at" -> "@". If there are several, the real one is the last
  //    that still leaves a plausible domain behind it.
  const atIdxs = tokens.reduce<number[]>((acc, t, i) => (t === "at" ? [...acc, i] : acc), []);
  if (atIdxs.length && !tokens.includes("@")) {
    let chosen = atIdxs[atIdxs.length - 1];
    for (const i of atIdxs) {
      const rest = tokens.slice(i + 1);
      const sld = rest.find((t) => /^[a-z0-9]+$/.test(t));
      if (sld && (TOP_SLDS.has(sld) || rest.includes("."))) {
        chosen = i;
        break;
      }
    }
    tokens[chosen] = "@";
    tokens = tokens.filter((t, i) => t !== "at" || i === chosen);
  }

  // 8. Join everything; single-letter runs collapse naturally since separators
  //    are their own tokens by now.
  const joined = tokens.join("").replace(/\s+/g, "");
  if (!joined.includes("@")) return fail();

  const at = joined.lastIndexOf("@");
  // Callers end a spelled suffix with a period ("...j r. at gmail dot com"),
  // and STT keeps it. A separator hard against the @ is always punctuation,
  // never part of the address.
  const local = joined.slice(0, at).replace(/^[._+-]+|[._+-]+$/g, "");
  const rawDomain = joined.slice(at + 1).replace(/^\.+|\.+$/g, "");
  if (!local || !rawDomain) return fail();

  const { domain, corrected, ambiguous } = correctDomain(rawDomain);
  const email = `${local}${"@"}${domain}`;
  const valid = isValidEmail(email);

  // 9. Ambiguities we refuse to resolve silently. "junior" is the exact thing
  //    that got dropped on the call that prompted this module.
  const alternatives: { reason: string; candidates: string[] }[] = [];
  if (/junior$/.test(local) || /jr$/.test(local)) {
    const base = local.replace(/(junior|jr)$/, "");
    const pair = [`${base}jr@${domain}`, `${base}junior@${domain}`];
    if (pair[0] !== pair[1]) {
      alternatives.push({ reason: "junior", candidates: pair });
    }
  }
  if (/senior$/.test(local) || /sr$/.test(local)) {
    const base = local.replace(/(senior|sr)$/, "");
    alternatives.push({ reason: "senior", candidates: [`${base}sr@${domain}`, `${base}senior@${domain}`] });
  }
  // Deliberately no "digit" ambiguity: numbers in an address are common and
  // unremarkable, and flagging every one of them buys an extra question on the
  // call for nothing.

  return {
    email: valid ? email : joined,
    valid,
    spellback: valid ? spellbackFor(email) : "",
    confidence: !valid || ambiguous || alternatives.length ? "low" : "high",
    ...(corrected ? { correctedDomain: corrected } : {}),
    ...(alternatives.length ? { alternatives } : {}),
    raw: original,
  };
}

// How spelled letters are joined in the read-back. A plain space reads as
// letters on most TTS voices; if Savannah mushes "M A T T" into "matt", change
// this to ". " or "-" and re-listen (scripts/test-email.ts --speak).
const LETTER_JOINER = " ";

function spellOut(word: string): string {
  return word
    .split("")
    .map((ch) => {
      if (ch === ".") return "dot";
      if (ch === "_") return "underscore";
      if (ch === "-") return "dash";
      if (ch === "+") return "plus";
      return ch.toUpperCase();
    })
    .join(LETTER_JOINER);
}

/**
 * The exact words the assistant should say back.
 *
 * The local part is spelled (that's where the errors are, and a dropped "jr"
 * is impossible to miss when spelled). A well-known domain is spoken as a
 * word — spelling "G M A I L" doubles the turn length for nothing. Never emits
 * "space", and never invents an "as in" word.
 */
export function spellbackFor(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 0) return "";
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);

  const dotIdx = domain.indexOf(".");
  const sld = dotIdx < 0 ? domain : domain.slice(0, dotIdx);
  const tld = dotIdx < 0 ? "" : domain.slice(dotIdx + 1);

  const spokenDomain = TOP_SLDS.has(sld) ? sld : spellOut(sld);
  const spokenTld = tld ? ` dot ${tld.split(".").join(" dot ")}` : "";

  return `${spellOut(local)} at ${spokenDomain}${spokenTld}`;
}
