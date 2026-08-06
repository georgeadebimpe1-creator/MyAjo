const META_TOKEN = process.env.META_WHATSAPP_TOKEN
const META_PHONE_NUMBER_ID = process.env.META_PHONE_NUMBER_ID
const META_API_URL = `https://graph.facebook.com/v20.0/${META_PHONE_NUMBER_ID}/messages`

export async function sendMessage(to, message) {
  const response = await fetch(META_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${META_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body: message },
    }),
  })

  if (!response.ok) {
    const errorBody = await response.text()
    console.error('Meta send failed:', response.status, errorBody)
  }
}
