
// Anchor API helpers — account creation for each trader.
//
// Built and corrected against Anchor's actual published documentation
// (docs.getanchor.co/docs/create-individual-customer-1 and
// docs.getanchor.co/docs/individual-customer-kyc), not guessed from
// training data. Two real bugs were found and fixed here on 2026-08-16:
//   1. dateOfBirth and gender were being sent as top-level attributes.
//      Anchor's own example nests them inside `identificationLevel2`
//      alongside bvn — that's Anchor's Tier 1 KYC upgrade, and it was
//      very likely being silently ignored or rejected as written before.
//   2. phoneNumber was being converted to 234XXXXXXXXXX format. Anchor's
//      own example uses the plain local format ("07061234507") — the
//      same 0XXXXXXXXXX format already used internally for
//      whatsapp_number. No conversion needed; removed it.
//
// STILL UNCONFIRMED — worth real sandbox testing before fully trusting:
//   - Whether a separate "customer" record truly must be created before
//     a deposit account (this code assumes yes, per Anchor's flow).
//   - Whether SAVINGS is genuinely usable as a deposit account product
//     type (their docs say yes; their support email reportedly said
//     otherwise — worth a direct sandbox test either way).

const ANCHOR_API_URL = process.env.ANCHOR_API_URL || 'https://api.getanchor.co/api/v1'
const ANCHOR_API_KEY = process.env.ANCHOR_API_KEY

// Anchor's documented shape for `address` is exactly these five fields.
// `addressLine_2` isn't something MyAjo collects separately from the
// trader — Anchor's own sample request reuses addressLine_1 for both,
// so we do the same rather than sending an empty string.
function normalizeAddress(address) {
  return {
    addressLine_1: address.addressLine_1,
    addressLine_2: address.addressLine_2 || address.addressLine_1,
    city: address.city || '',
    state: address.state,
    postalCode: address.postalCode || '',
    country: address.country || 'NG',
  }
}

// Step 1: Create (or reuse) an Anchor customer record for this trader,
// at Tier 1 KYC (full name/address/email/phone at creation, plus
// identificationLevel2 for the BVN-backed identity upgrade).
async function createAnchorCustomer({ fullName, email, phone, dob, gender, address, bvn }) {
  const [firstName, ...rest] = fullName.trim().split(' ')
  const lastName = rest.join(' ') || firstName

  const response = await fetch(`${ANCHOR_API_URL}/customers`, {
    method: 'POST',
    headers: {
      'x-anchor-key': ANCHOR_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      data: {
        type: 'IndividualCustomer',
        attributes: {
          fullName: { firstName, lastName },
          address: normalizeAddress(address),
          email,
          phoneNumber: phone,
          // FIX: these three belong together under identificationLevel2 —
          // this is what triggers Anchor's automatic Tier 1 KYC check
          // (name + phone on the BVN record must match what's above).
          identificationLevel2: {
            dateOfBirth: dob,
            gender,
            bvn,
          },
        },
      },
    }),
  })

  const result = await response.json()
  if (!response.ok) {
    console.error('Anchor customer creation failed:', response.status, JSON.stringify(result))
    throw new Error('Anchor customer creation failed')
  }
  return result.data.id // Anchor's customer ID
}

// Step 2: Create a dedicated SAVINGS deposit account for that customer.
async function createAnchorDepositAccount(anchorCustomerId) {
  const response = await fetch(`${ANCHOR_API_URL}/accounts`, {
    method: 'POST',
    headers: {
      'x-anchor-key': ANCHOR_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      data: {
        type: 'DepositAccount',
        attributes: { productName: 'SAVINGS' },
        relationships: {
          customer: { data: { id: anchorCustomerId, type: 'IndividualCustomer' } },
        },
      },
    }),
  })

  const result = await response.json()
  if (!response.ok) {
    console.error('Anchor account creation failed:', response.status, JSON.stringify(result))
    throw new Error('Anchor account creation failed')
  }
  // NOTE: Anchor's docs say this can be async (202 response) — the account
  // number may not be available immediately. Worth checking in sandbox
  // whether it comes back right away or needs a follow-up GET request.
  return {
    accountId: result.data.id,
    accountNumber: result.data.attributes?.accountNumber || null,
    bankName: result.data.attributes?.bankName || null,
  }
}

export { createAnchorCustomer, createAnchorDepositAccount }
