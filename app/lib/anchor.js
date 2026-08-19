// Anchor API helpers — account creation and money movement for each trader.
//
// IMPORTANT: customer/deposit-account creation below is built from Anchor's
// public docs, not yet confirmed against a real sandbox response — see the
// STATUS note on provisionAnchorAccount in lib/accounts.js.
//
// The transfer functions below (listBanks, verifyAccountNumber,
// createCounterParty, initiateBookTransfer, initiateNipTransfer,
// verifyTransfer) ARE confirmed against Anchor's published docs, including
// one important detail: amount is in the SMALLEST currency unit (kobo for
// NGN), confirmed explicitly in Anchor's Bank (NIP) Transfer docs. Every
// function below takes amountNaira and converts to kobo internally, so
// every CALLER of this file stays in Naira — consistent with the rest of
// the app (see the UNITS note in route.js).
export const ANCHOR_API_URL_UNUSED = null;
// Defaults to SANDBOX on purpose. If ANCHOR_API_URL is ever missing or
// wiped from Vercel's env vars, this should fail safe toward test data,
// not silently start hitting Anchor's production system. Production
// use REQUIRES setting ANCHOR_API_URL explicitly in Vercel — it should
// never rely on this fallback.
const ANCHOR_API_URL = process.env.ANCHOR_API_URL || 'https://api.sandbox.getanchor.co/api/v1'
const ANCHOR_API_KEY = process.env.ANCHOR_API_KEY

const ANCHOR_HEADERS = {
  'x-anchor-key': ANCHOR_API_KEY,
  'Content-Type': 'application/json',
}

// Step 1: Create (or reuse) an Anchor customer record for this trader.
// ASSUMPTION: Anchor requires a customer to exist before a deposit account
// can be created for them — this mirrors the pattern in their docs for
// individual verification, but hasn't been tested against a real response.
async function createAnchorCustomer({ fullName, email, phone, dob, gender, address, bvn }) {
  const [firstName, ...rest] = fullName.trim().split(' ')
  const lastName = rest.join(' ') || firstName
  const response = await fetch(`${ANCHOR_API_URL}/customers`, {
    method: 'POST',
    headers: ANCHOR_HEADERS,
    body: JSON.stringify({
      data: {
        type: 'IndividualCustomer',
        attributes: {
          fullName: { firstName, lastName },
          email,
          phoneNumber: phone,
          address,
          // dateOfBirth, gender, and bvn belong together here — confirmed
          // against Anchor's own documented example. This exact grouping
          // was fixed once already; if you're reading this after another
          // regression, that's the thing to check first.
          identificationLevel2: { dateOfBirth: dob, gender, bvn },
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
// CONFIRMED (2026 Slack thread with Anchor): each trader gets their own
// individual DepositAccount — this was the right architecture all along.
async function createAnchorDepositAccount(anchorCustomerId) {
  const response = await fetch(`${ANCHOR_API_URL}/accounts`, {
    method: 'POST',
    headers: ANCHOR_HEADERS,
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

// Step 1b: Trigger KYC verification for a customer that was already
// created. CONFIRMED against Anchor's docs (docs.getanchor.co/docs/
// individual-customer-kyc) — passing bvn/dateOfBirth/gender at customer
// CREATION time does NOT verify them; Anchor's own example response for
// that case still comes back "verification": {"status": "unverified"}.
// This separate call is required, and Anchor processes it async — the
// real result (approved/error/rejected) arrives later as a webhook
// event, not in this function's response. This function only confirms
// Anchor *accepted* the verification request, not that it passed.
async function verifyAnchorCustomerKyc(anchorCustomerId, { bvn, dob, gender }) {
  const response = await fetch(`${ANCHOR_API_URL}/customers/${anchorCustomerId}/verification/individual`, {
    method: 'POST',
    headers: ANCHOR_HEADERS,
    body: JSON.stringify({
      data: {
        type: 'Verification',
        attributes: {
          level: 'TIER_2',
          level2: { bvn, dateOfBirth: dob, gender },
        },
      },
    }),
  })
  const result = await response.json()
  if (!response.ok) {
    console.error('Anchor KYC verification request failed:', response.status, JSON.stringify(result))
    throw new Error('Anchor KYC verification request failed')
  }
  // This just means Anchor accepted the request and will send a webhook
  // (customer.identification.approved/error/rejected) with the real result.
  return result
}

// CONFIRMED — GET /api/v1/banks. Returns the full list of banks Anchor
// can send NIP transfers to, each with a nipCode used as bankCode
// elsewhere in this file. Used by lib/bankMatch.js to resolve whatever
// bank name a trader typed during onboarding into a real code.
async function listBanks() {
  const response = await fetch(`${ANCHOR_API_URL}/banks`, {
    method: 'GET',
    headers: ANCHOR_HEADERS,
  })
  const result = await response.json()
  if (!response.ok) {
    console.error('Anchor listBanks failed:', response.status, JSON.stringify(result))
    throw new Error('Could not fetch bank list from Anchor')
  }
  // Response is a bare array of { id, type, attributes: { nipCode, name } }
  const banks = Array.isArray(result) ? result : result.data || []
  return banks.map(b => ({ code: b.attributes?.nipCode, name: b.attributes?.name }))
}

// CONFIRMED — GET /api/v1/payments/verify-account/{bankCode}/{accountNumber}.
// Confirms an account number is real and returns the account holder's name
// as it appears at the other bank — used as a safety check before trusting
// a trader-typed account number, catching typos before 30 days of saving.
async function verifyAccountNumber(bankCode, accountNumber) {
  const response = await fetch(
    `${ANCHOR_API_URL}/payments/verify-account/${bankCode}/${accountNumber}`,
    { method: 'GET', headers: ANCHOR_HEADERS }
  )
  const result = await response.json()
  if (!response.ok) {
    console.error('Anchor verifyAccountNumber failed:', response.status, JSON.stringify(result))
    throw new Error('Could not verify that account number')
  }
  return {
    accountName: result.data?.attributes?.accountName || null,
    accountNumber: result.data?.attributes?.accountNumber || accountNumber,
  }
}

// CONFIRMED — POST /api/v1/counterparties. Creates (or, per Anchor's docs,
// returns the existing) saved beneficiary for NIP transfers. verifyName:
// true makes Anchor confirm the account itself and return the REAL name
// on file at the other bank, regardless of what name we pass in — this is
// the strongest guard against a mistyped account number.
async function createCounterParty({ bankCode, accountName, accountNumber }) {
  const requestBody = {
    data: {
      type: 'CounterParty',
      attributes: {
        bankCode,
        accountName,
        accountNumber,
        verifyName: true,
      },
    },
  }
  // Logs the outgoing request whenever this fails, alongside the
  // existing response log below — previously only the response was
  // captured, which made it impossible to see the exact payload sent
  // when reporting an error back to Anchor's support team.
  const response = await fetch(`${ANCHOR_API_URL}/counterparties`, {
    method: 'POST',
    headers: ANCHOR_HEADERS,
    body: JSON.stringify(requestBody),
  })
  const result = await response.json()
  if (!response.ok) {
    console.error('Anchor createCounterParty failed:', response.status, JSON.stringify(result), 'Request sent:', JSON.stringify(requestBody))
    throw new Error('Could not save that bank account with Anchor')
  }
  return {
    counterPartyId: result.data.id,
    verifiedAccountName: result.data.attributes?.accountName || null,
    bank: result.data.attributes?.bank || null,
  }
}

// CONFIRMED — POST /api/v1/transfers, type BookTransfer. Free, instant,
// internal movement between two Anchor DepositAccounts — used for the
// commission sweep from a trader's account into MyAjo's master account.
async function initiateBookTransfer({ fromAccountId, toAccountId, amountNaira, reason, reference }) {
  const response = await fetch(`${ANCHOR_API_URL}/transfers`, {
    method: 'POST',
    headers: ANCHOR_HEADERS,
    body: JSON.stringify({
      data: {
        type: 'BookTransfer',
        attributes: {
          currency: 'NGN',
          amount: Math.round(amountNaira * 100), // kobo — confirmed in Anchor's docs
          reason,
          reference,
        },
        relationships: {
          destinationAccount: { data: { type: 'DepositAccount', id: toAccountId } },
          account: { data: { type: 'DepositAccount', id: fromAccountId } },
        },
      },
    }),
  })
  const result = await response.json()
  if (!response.ok) {
    console.error('Anchor initiateBookTransfer failed:', response.status, JSON.stringify(result))
    throw new Error('Commission sweep could not be initiated')
  }
  return {
    transferId: result.data.id,
    status: result.data.attributes?.status || 'PENDING',
  }
}

// CONFIRMED — POST /api/v1/transfers, type NIPTransfer. Sends money to an
// external bank via a previously created CounterParty — used for the net
// payout to a trader's own bank account.
async function initiateNipTransfer({ fromAccountId, counterPartyId, amountNaira, reason, reference }) {
  const response = await fetch(`${ANCHOR_API_URL}/transfers`, {
    method: 'POST',
    headers: ANCHOR_HEADERS,
    body: JSON.stringify({
      data: {
        type: 'NIPTransfer',
        attributes: {
          currency: 'NGN',
          amount: Math.round(amountNaira * 100), // kobo — confirmed in Anchor's docs
          reason,
          reference,
        },
        relationships: {
          account: { data: { type: 'DepositAccount', id: fromAccountId } },
          counterParty: { data: { type: 'CounterParty', id: counterPartyId } },
        },
      },
    }),
  })
  const result = await response.json()
  if (!response.ok) {
    console.error('Anchor initiateNipTransfer failed:', response.status, JSON.stringify(result))
    throw new Error('Payout transfer could not be initiated')
  }
  return {
    transferId: result.data.id,
    status: result.data.attributes?.status || 'PENDING', // NIP transfers commonly come back PENDING
  }
}

// CONFIRMED — GET /api/v1/transfers/verify/{transferId}. A freshly
// initiated NIP transfer often comes back PENDING, not COMPLETED — this
// polls Anchor for the real final status rather than trusting the
// initial POST response, which per Anchor's docs may not reflect
// whether the money has actually landed yet.
async function verifyTransfer(transferId) {
  const response = await fetch(`${ANCHOR_API_URL}/transfers/verify/${transferId}`, {
    method: 'GET',
    headers: ANCHOR_HEADERS,
  })
  const result = await response.json()
  if (!response.ok) {
    console.error('Anchor verifyTransfer failed:', response.status, JSON.stringify(result))
    throw new Error('Could not verify transfer status')
  }
  return {
    status: result.data?.attributes?.status || 'PENDING',
  }
}

export {
  createAnchorCustomer,
  createAnchorDepositAccount,
  verifyAnchorCustomerKyc,
  listBanks,
  verifyAccountNumber,
  createCounterParty,
  initiateBookTransfer,
  initiateNipTransfer,
  verifyTransfer,
}
