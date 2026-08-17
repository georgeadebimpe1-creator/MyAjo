// app/lib/bankMatch.js
//
// Resolves whatever bank name a trader typed during onboarding into a
// real Anchor bankCode. Deliberately conservative: only auto-resolves on
// a single confident match. Anything ambiguous or unmatched is handed
// back to the trader to pick from a numbered list — this code never
// silently guesses, because a wrong bankCode sends real money to the
// wrong bank at payout time, not a recoverable mistake.

import { listBanks } from './anchor'

// Anchor's bank list rarely changes — cached for the lifetime of this
// server instance instead of re-fetched on every onboarding message.
let cachedBanks = null
async function getBanks() {
  if (!cachedBanks) {
    cachedBanks = await listBanks()
  }
  return cachedBanks
}

// Strips common suffixes/noise so "GTBank", "GT Bank", "Guaranty Trust
// Bank", and "guaranty trust bank plc" have a fighting chance of
// normalizing toward the same comparable string. Deliberately simple —
// no fuzzy-matching library — because approximate matching is exactly
// what we don't want here; false positives are the actual risk.
function normalize(name) {
  return name
    .toLowerCase()
    .replace(/\bplc\b/g, '')
    .replace(/\blimited\b|\bltd\b/g, '')
    .replace(/\bmicrofinance\b/g, '')
    .replace(/\bbank\b/g, '')
    .replace(/[^a-z0-9]/g, '')
    .trim()
}

// Returns exactly one of:
//   { match: { code, name } }                — confident single match, safe to proceed silently
//   { candidates: [{ code, name }, ...] }     — 2+ plausible matches, trader must pick
//   { candidates: [] }                        — nothing close, ask trader to retype
export async function resolveBankFromName(typedName) {
  const banks = await getBanks()
  const normalizedTyped = normalize(typedName)

  const exact = banks.filter(b => normalize(b.name) === normalizedTyped)
  if (exact.length === 1) {
    return { match: exact[0] }
  }

  // No exact normalized match — fall back to "typed name is contained in
  // (or contains) the real bank name", which catches common shorthand
  // like "gtb" -> "GTBank" or "access" -> "ACCESS BANK". Still requires
  // human confirmation unless it narrows to exactly one candidate.
  const contains = banks.filter(
    b => normalize(b.name).includes(normalizedTyped) || normalizedTyped.includes(normalize(b.name))
  )

  if (contains.length === 1) {
    return { match: contains[0] }
  }

  // Cap candidates shown to the trader — if the fuzzy pass returns too
  // many (a very short/generic typed name), showing 15 options is worse
  // than asking them to retype something more specific.
  return { candidates: contains.slice(0, 6) }
}
