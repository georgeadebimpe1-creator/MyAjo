// app/lib/messages.js
//
// PHASE 1 (welcome/disclaimer, HELP, BALANCE) — language selection only.
// Onboarding steps and WITHDRAW stay English-only until reviewed.
//
// TRANSLATION CONFIDENCE — READ BEFORE LAUNCHING TO REAL USERS:
//   English (en) — authoritative, this is the source text.
//   Yoruba  (yo) — reasonably confident, still recommend a native check
//                  on the money-specific phrasing before go-live.
//   Hausa   (ha) — reviewed and approved by a native speaker.
//   Igbo    (ig) — first draft, not yet reviewed. Do not launch to real
//                  Igbo-speaking traders until it has been checked,
//                  specifically the words for "commission", "withdraw",
//                  and "locked".
//
// PHASE 1B — payment notifications (added below). English only for now,
// same policy as onboarding. These consolidate what used to be several
// separate messages into one, to cut WhatsApp per-message costs. Before
// going live with these at scale, submit the three bodies below as
// approved WhatsApp Message Templates in Meta Business Manager — any
// message your business sends that ISN'T a direct reply to something
// the trader just typed (the Anchor payment confirmation, the daily
// reminder) needs to go out as an approved template to guarantee
// delivery, not as plain text.

export const LANGUAGES = {
  '1': 'en',
  '2': 'ha',
  '3': 'ig',
  '4': 'yo',
}

// Shown before we know the trader's language, so it has to carry enough
// of each language to be understood by whoever's reading it.
export const LANGUAGE_SELECT_MESSAGE = `Welcome to MyAjo!

Please choose your language / Zaɓi harshenka / Họrọ asụsụ gị / Yan ede rẹ:

1. English
2. Hausa
3. Igbo
4. Yoruba`

const DISCLAIMER = {
  en: 'Important: MyAjo only recognises contributions made through this WhatsApp number or MyAjo USSD. Any transfer or cash payment made outside these channels will not be recorded and cannot be refunded.',
  yo: 'Ẹ ṣe akiyesi: MyAjo yoo gba owo ti a fi n ranṣẹ nikan nipasẹ nọmba WhatsApp yii tabi USSD MyAjo. Owo ti a ba fi ranṣẹ ni ọna miiran ko ni han loodo wa a ko de ni le da a pada.',
  ha: 'Muhimmi: Asusun MyAjo zai karɓi kuɗi ne kawai ta wannan lambar WhatsApp ko USSD na MyAjo. Duk wani kuɗin da aka aika ta wata hanya dabam ba za a rubuta shi ba, kuma babu da hannun MyAjo a ciki. Don haka asarar tana ga wanda yatura kudin.',
  ig: 'Ihe dị mkpa: MyAjo ga-anabata naanị ego ezitere site na nọmba WhatsApp a ma ọ bụ USSD MyAjo. Ego ọ bụla ezitere site na ụzọ ọzọ agaghị edekọ ya, a gaghị enyeghachikwa ya azụ.',
}

const WELCOME = {
  en: `Welcome to MyAjo. I am Temi, your personal savings assistant.

I am here to help you build a consistent daily savings habit.

{disclaimer}

Please choose an option:

1. Start Daily Savings
2. Check My Balance
3. Learn How It Works
4. Speak with Support

Reply with a number.`,
  yo: `Kaabo si MyAjo. Emi ni Temi, oluranlọwọ ifowopamọ ẹ.

Mo wa nibi lati ran ọ lọwọ lati ni ihuwasi ifowopamọ ojoojumọ.

{disclaimer}

Jọwọ yan ọkan:

1. Bẹrẹ Ifowopamọ Ojoojumọ
2. Wo Iye Owo Re
3. Kọ Bi O Ṣe Nṣiṣẹ
4. Ba Support Sọrọ

Dahun pẹlu nọmba nkan to fe se.`,
  ha: `Barka da zuwa Adashen MyAjo. Ni ce Temi, mataimakiyar ajiyar ku.

Muna tare har sai kun samu jajircewa da  juriya don ajiyar yau da kullum.
Ina nan don taimaka muku ku samu al'adar ajiya ta yau da kullum.

{disclaimer}

Da fatan za a zaɓi ɗaya:
Zabi ɗaya daya dace da kudurinka:

1. Fara zubi Kullum
2. Tantace nawa na tara kawo yanzu
3. Fahimtar yadda wannan manhajar Yake Aiki
4. Karin fahimta da neman taimako

Ka amsa da lamba: daya, biyu, uku ko hudu.`,
  ig: `Nnọọ na MyAjo. Abụ m Temi, onye enyemaka nchekwa ego gị.

Anọ m ebe a ka m nyere gị aka ịmepụta omume ịchekwa ego kwa ụbọchị.

{disclaimer}

Biko họrọ otu:

1. Malite Nchekwa Kwa Ụbọchị
2. Lelee Ego M
3. Mụta Otu Ọ Si Arụ Ọrụ
4. Kpọtụrụ Support

Zaghachi site na nọmba.`,
}

const HELP = {
  en: `Temi Commands

MENU - Return to main menu
BALANCE - Check your savings
PAID - Confirm today's transfer has gone through
WITHDRAW 5000 - Withdraw an amount from your savings (available from day 10)
FREEZE - Freeze your account
HELP - Show this menu

Withdrawing before your 30 day cycle ends attracts a small charge from our banking partner (N50 up to N10,000, N100 above that). MyAjo never adds anything on top. Complete the full cycle and there is no charge at all.

{disclaimer}

For support contact hello@myajo.com.ng`,
  yo: `Awọn Ilana Temi

MENU - Pada si akojọ akọkọ
BALANCE - Ye iye owo rẹ
PAID - Jẹrisi pe owo oni ti wọle
WITHDRAW 5000 - O lanfanin lati yọ owo kekere kuro ninu ifowopamọ rẹ (lati ọjọ kewa (10) ti o bere ajo re).
FREEZE - Da account rẹ duro
HELP - Fi akojọ yii han

Yiyọ owo ṣaaju ki ọjọ 30 to pari a maa gba owo kekere lati ọdọ alabaṣepọ banki wa (N50 fun owo ti o to N10,000, N100 to ba ju bẹẹ lọ). MyAjo ko fi ohunkohun kun. Pari ọjọ 30 patapata, ki o si gba owo pe.

{disclaimer}

Fun iranlọwọ, kan si hello@myajo.com.ng`,
  ha: `Umarnin Temi

MENU - Koma babban jerin
BALANCE - Duba ajiyar ku
PAID - Tabbatar da cewa an aika kuɗin yau
WITHDRAW 5000 - Cire kuɗi daga ajiyar ku (daga rana ta 10)
FREEZE - Dakatar da asusun ku
HELP - Kara nuna wannan jerin bayanan

Za'a iya cire kuɗi kafin kwanaki 30 su cika amma akwai ƙaramin caji daga bankinda ke tayamu ajiya daga Naira hamsin (N50) har zuwa dubu goma (N10,000, N100 sama da haka).Adashen MyAjo ba ya ƙara komai a kai. Amma idan kuka jure kammala kwanaki 30 cik, toh babu wani caji ko kaɗan da zaku biya.

{disclaimer}

Don karin bayani, tuntuɓi hello@myajo.com.ng`,
  ig: `Iwu Temi

MENU - Laghachi na ndepụta izugbe
BALANCE - Lelee ego gị
PAID - Kwenye na e zigala ego taa
WITHDRAW 5000 - Wepụ ego site na nchekwa gị (site na ụbọchị nke 10)
FREEZE - Kwụsị akaụntụ gị
HELP - Gosi ndepụta a

Iwepụ ego tupu ụbọchị 30 agwụ na-abụ obere ụgwọ site n'aka ndị mmekọ akụ na ụba anyị (N50 ruo N10,000, N100 karịa nke ahụ). MyAjo anaghị agbakwunye ihe ọ bụla. Ọ bụrụ na ị rụchara ụbọchị 30 zuru ezu, a naghị agbakwunye ụgwọ ọ bụla.

{disclaimer}


Maka enyemaka, kpọtụrụ hello@myajo.com.ng`,
}

// BALANCE is dynamic — built as a function that takes the real numbers.
const BALANCE = {
  en: ({ name, saved, daysContributed, progressBar, progressPercent, expectedTotal, commission, expectedPayout, withdrawLine }) =>
    `Your Savings

Hello ${name}

Saved: N${saved}
Days completed: ${daysContributed} of 30

Progress: ${progressBar} ${progressPercent}%

Expected total: N${expectedTotal}
MyAjo commission: N${commission}
Your payout: N${expectedPayout}${withdrawLine}

Keep saving every day!`,
  yo: ({ name, saved, daysContributed, progressBar, progressPercent, expectedTotal, commission, expectedPayout, withdrawLine }) =>
    `Ifowopamọ Rẹ

E nle be o! ${name}

Owo ti mo ti fipamọ: N${saved}
Awọn ọjọ ti mo ti pari: ${daysContributed} ninu 30

Ilọsiwaju mi: ${progressBar} ${progressPercent}%

Iye ti mo n reti: N${expectedTotal}
Owo iṣẹ MyAjo: N${commission}
Owo mi: N${expectedPayout}${withdrawLine}

E tesiwaju lati fi owo pamọ lojoojumọ!`,
  ha: ({ name, saved, daysContributed, progressBar, progressPercent, expectedTotal, commission, expectedPayout, withdrawLine }) =>
    `Ajiyar Ku

Sannu ${name}

An ajiye: N${saved}
Kwanakin da aka kammala: ${daysContributed} zubi nawa nayi a cikin kwana 30

Ci gaba: ${progressBar} ${progressPercent}%

Jimlar da ake tsammani: N${expectedTotal}
Kuɗin caji dawainiyar MyAjo: N${commission}
Jamillar kuɗi na: N${expectedPayout}${withdrawLine}

Ci gaba da ajiya kowace rana!`,
  ig: ({ name, saved, daysContributed, progressBar, progressPercent, expectedTotal, commission, expectedPayout, withdrawLine }) =>
    `Nchekwa Gị

Ndewo ${name}

Echekwara: N${saved}
Ụbọchị e mechara: ${daysContributed} n'ime 30

Ọganihu: ${progressBar} ${progressPercent}%

Ngụkọta a tụrụ anya ya: N${expectedTotal}
Ụgwọ ọrụ MyAjo: N${commission}
Ego gị: N${expectedPayout}${withdrawLine}

Gaa n'ihu na-echekwa ego kwa ụbọchị!`,
}

// ── PHASE 1B: payment notifications ─────────────────────────────────
// English only. One compact message each, replacing what used to be
// three or four separate lines sent as separate messages.

const CONTRIBUTION_RECORDED = {
  en: ({ amount, dayNumber, totalSaved, daysRemaining }) =>
`✅ *Payment Received*

₦${amount} received successfully.

🔥 Day ${dayNumber} of 30

Total Saved:
₦${totalSaved}

${daysRemaining} days remaining.

See you tomorrow.`,
}

const DAILY_REMINDER = {
  en: ({ dailyAmount, streakDays }) =>
`🔔 *Daily Reminder*

Today's contribution:
₦${dailyAmount}

Current streak:
${streakDays} days

Reply PAID after making your transfer.`,
}

// Commission and net payout are shown even though your example left
// them out — traders need to see the exact amount landing in their
// account, since it's the total minus the 3% commission, not the
// full savings figure. Worth keeping for trust and to head off
// support messages asking "why is this less than I saved".
const CYCLE_COMPLETE = {
  en: ({ totalSaved, commission, netPayout }) =>
`🎉 *Congratulations!*

You completed your 30-day savings cycle.

Savings:
₦${totalSaved}

MyAjo commission (3%):
₦${commission}

Your payout of ₦${netPayout} has been sent.

Ready to begin your next cycle? Type YES.`,
}

export function getMessage(key, lang, params = {}) {
  const safeLang = ['en', 'ha', 'ig', 'yo'].includes(lang) ? lang : 'en'

  if (key === 'welcome') {
    return WELCOME[safeLang].replace('{disclaimer}', DISCLAIMER[safeLang])
  }
  if (key === 'help') {
    return HELP[safeLang].replace('{disclaimer}', DISCLAIMER[safeLang])
  }
  if (key === 'balance') {
    return BALANCE[safeLang](params)
  }
  if (key === 'contribution_recorded') {
    return CONTRIBUTION_RECORDED.en(params)
  }
  if (key === 'daily_reminder') {
    return DAILY_REMINDER.en(params)
  }
  if (key === 'cycle_complete') {
    return CYCLE_COMPLETE.en(params)
  }

  return null
}
