// Anchor API helpers — account creation for each trader.
//
// IMPORTANT: this is built strictly from Anchor's public API documentation,
// NOT confirmed directly with Anchor support (they haven't responded).
// Two things specifically need real-sandbox testing once you have access:
//   1. Whether an Anchor "customer" record needs to be created separately
//      before the deposit account (this code assumes yes, based on the docs).
//   2. Whether SAVINGS is genuinely usable, despite their support email
//      saying otherwise — their own docs say yes, worth verifying in sandbox.

export const ANCHOR_API_URL_UNUSED = null;
const ANCHOR_API_URL = process.env.ANCHOR_API_URL || 'https://api.getanchor.co/api/v1'
const ANCHOR_API_KEY = process.env.ANCHOR_API_KEY

// Step 1: Create (or reuse) an Anchor customer record for this trader.
// ASSUMPTION: Anchor requires a customer to exist before a deposit account
// can be created for them — this mirrors the pattern in their docs for
// individual verification, but hasn't been tested against a real response.
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
          email,
          phoneNumber: phone,
          dateOfBirth: dob,
          gender,
          address,
          identificationLevel2: { bvn },
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
