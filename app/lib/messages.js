// app/lib/messages.js
//
// PHASE 1 (welcome/disclaimer, HELP, BALANCE) — language selection only.
//
// PHASE 2 (added below) — the rest of the conversation flow: onboarding,
// plan confirmation, activation, withdrawals, freeze, support, and every
// other reply the bot sends. This closes the gap where a trader could
// pick Hausa/Igbo/Yoruba at the very first question and then have the
// entire rest of the conversation switch back to English.
//
// TRANSLATION CONFIDENCE — READ BEFORE LAUNCHING TO REAL USERS:
//   English (en) — authoritative, this is the source text, for both
//                  Phase 1 and Phase 2.
//   Yoruba  (yo) — Phase 1 content is reasonably confident (still worth
//                  a native check on money-specific phrasing). Phase 2
//                  content below is a FIRST DRAFT, not yet reviewed.
//   Hausa   (ha) — Phase 1 content reviewed and approved by a native
//                  speaker. Phase 2 content below is a FIRST DRAFT, not
//                  yet reviewed — treat it the same as Igbo below until
//                  checked.
//   Igbo    (ig) — first draft throughout, Phase 1 and Phase 2 alike.
//                  Do not launch to real Igbo-speaking traders until
//                  reviewed, specifically "commission", "withdraw", and
//                  "locked".
//
// Bottom line: ONLY the original Phase 1 Hausa content has been
// confirmed accurate by a native speaker. Everything else in this file —
// all of Phase 2, plus Yoruba and Igbo Phase 1 — is draft quality and
// needs a native-speaker pass on the actual financial terms before it
// reaches real traders. Wrong wording around "commission", "withdraw",
// or "locked" specifically is the kind of mistake that costs trust with
// money involved, so treat this file as pending review, not launch-ready.
//
// PHASE 1B — payment notifications (contribution_recorded, daily_reminder,
// cycle_complete). English only for now — these are WhatsApp Message
// Templates that need separate approval in Meta Business Manager before
// they can go out in other languages, since they aren't a direct reply
// to something the trader just typed.

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

// ── PHASE 2: the rest of the conversation ───────────────────────────
// Static strings grouped as {en, ha, ig, yo}. Dynamic ones are functions
// per language, same pattern as BALANCE above.

const ACTIVE_CYCLE_EXISTS = {
  en: `You already have an active savings cycle running.

Type BALANCE to check your savings, PAID to confirm today's transfer, or WITHDRAW followed by an amount to withdraw.`,
  ha: `Kuna da zubi mai aiki tuni.

Rubuta BALANCE domin duba ajiyar ku, PAID domin tabbatar da kudin yau, ko WITHDRAW sannan adadin domin cire kuɗi.`,
  ig: `Ị nweelarị usoro nchekwa ego na-arụ ọrụ ugbu a.

Pịnye BALANCE iji lelee nchekwa gị, PAID iji kwenye na ego taa abanyela, ma ọ bụ WITHDRAW gbakwunyere ọnụọgụ iji wepụ ego.`,
  yo: `O ti ni ipe ifowopamọ to n ṣiṣẹ lọwọ tẹlẹ.

Tẹ BALANCE lati wo ifowopamọ rẹ, PAID lati jẹrisi owo oni, tabi WITHDRAW pẹlu iye owo lati yọ owo.`,
}

const RETURNING_TRADER_NEW_CYCLE = {
  en: ({ name }) => `Welcome back ${name}!

Ready to start a new 30-day savings cycle. How much would you like to save daily this time? (N1,000 - N10,000)`,
  ha: ({ name }) => `Barka da dawowa ${name}!

A shirye don fara sabon zubi na kwana 30. Nawa kake son adana kullum a wannan karo? (N1,000 - N10,000)`,
  ig: ({ name }) => `Nnọọ azụ ${name}!

Adịla njikere ịmalite usoro nchekwa ego ọhụrụ nke ụbọchị 30. Ego ole ka ị chọrọ ịchekwa kwa ụbọchị nʼoge a? (N1,000 - N10,000)`,
  yo: ({ name }) => `Kaabo pada ${name}!

Ti ṣetan lati bẹrẹ ipe ifowopamọ tuntun ti ọjọ 30. Elo ni o fẹ fi pamọ lojoojumọ ni akoko yii? (N1,000 - N10,000)`,
}

const ONBOARDING_INTRO = {
  en: ({ verifyLink }) => `Great! Let's set up your savings plan. Two things to do — in any order:

1) Verify your identity here (takes about a minute):
${verifyLink}

2) Reply here with your details, one per line:

Full Name
Email Address
Residential Address (Street, City, State)
Bank Name
Account Number
Daily savings amount (1000-10000)

Example:
Ada Okafor
ada@email.com
12 Market Road, Ikeja, Lagos
GTBank
0123456789
5000

Once you've done both, type DONE.`,
  ha: ({ verifyLink }) => `Madalla! Bari mu shirya tsarin ajiyar ku. Abubuwa biyu za a yi — kowanne zai iya farawa:

1) Tabbatar da ainihin ku a nan (yana ɗaukar minti daya kacal):
${verifyLink}

2) Amsa a nan da bayananku, layi ɗaya-ɗaya:

Cikakken Suna
Adireshin Imel
Adireshin Zama (Titi, Gari, Jiha)
Sunan Banki
Lambar Asusu
Adadin ajiya na yau da kullum (1000-10000)

Misali:
Ada Okafor
ada@email.com
12 Market Road, Ikeja, Lagos
GTBank
0123456789
5000

Idan kun gama duka biyun, rubuta DONE.`,
  ig: ({ verifyLink }) => `Ọ dị mma! Ka anyị hazie atụmatụ nchekwa gị. Ihe abụọ ka ị ga-eme — nʼusoro ọ bụla:

1) Gosi onye ị bụ nʼebe a (na-ewe ihe dị ka otu nkeji):
${verifyLink}

2) Zaghachi ebe a mkpụrụedemede gị, otu nʼahịrị ọ bụla:

Aha Zuru Ezu
Adreesị Email
Adreesị Obibi (Okporo ámá, Obodo, Steeti)
Aha Ụlọ Akụ
Nọmba Akaụntụ
Ego ị ga-echekwa kwa ụbọchị (1000-10000)

Ọmụmaatụ:
Ada Okafor
ada@email.com
12 Market Road, Ikeja, Lagos
GTBank
0123456789
5000

Ọ bụrụ na ị emechaala ihe abụọ ahụ, pịnye DONE.`,
  yo: ({ verifyLink }) => `O dara! Jẹ ki a to eto ifowopamọ rẹ. Nkan meji ni o gbọdọ ṣe — ni eyikeyi bere:

1) Jẹrisi ẹni ti o jẹ ni ibi yii (yoo gba iṣẹju kan):
${verifyLink}

2) Dahun nibi pẹlu awọn alaye rẹ, ọkan fun ila kọọkan:

Orukọ Kikun
Imeeli
Adirẹsi Ibugbe (Opopona, Ilu, Ipinlẹ)
Orukọ Banki
Nọmba Account
Iye owo ti o fẹ fi pamọ lojoojumọ (1000-10000)

Àpẹẹrẹ:
Ada Okafor
ada@email.com
12 Market Road, Ikeja, Lagos
GTBank
0123456789
5000

Nigba ti o ba ti ṣe awọn mejeeji, tẹ DONE.`,
}

const ONBOARDING_DETAILS_MISSING = {
  en: `I haven't received your details yet. Please send your full name, email, residential address, bank name, account number, and daily amount — each on its own line — then type DONE again.`,
  ha: `Ban samu bayananku ba tukuna. Da fatan za a aika cikakken suna, imel, adireshin zama, sunan banki, lambar asusu, da adadin kullum — kowanne a layi daban — sannan a sake rubuta DONE.`,
  ig: `Anaghị m enweta nkọwa gị ugbu a. Biko zipu aha gị zuru ezu, email, adreesị obibi, aha ụlọ akụ, nọmba akaụntụ, na ego kwa ụbọchị — nʼahịrị nke ọ bụla — mgbe ahụ pịnye DONE ọzọ.`,
  yo: `Mi o ti gba awọn alaye rẹ sibẹsibẹ. Jọwọ fi orukọ kikun, imeeli, adirẹsi ibugbe, orukọ banki, nọmba account, ati iye owo ojoojumọ — ọkan fun ila kọọkan — lẹhinna tẹ DONE lẹẹkansi.`,
}

const VERIFICATION_FAILED = {
  en: ({ verifyLink }) => `Hmm, we couldn't verify your details. This usually happens if the photo was blurry or didn't match your BVN.

Please try again here: ${verifyLink}

Then type DONE.`,
  ha: ({ verifyLink }) => `Hmm, ba mu iya tabbatar da bayananku ba. Wannan yakan faru idan hoton bai bayyana sosai ba ko bai dace da BVN ku ba.

Da fatan za a sake gwadawa a nan: ${verifyLink}

Sannan a rubuta DONE.`,
  ig: ({ verifyLink }) => `Hmm, anyị enweghị ike ịkwado nkọwa gị. Nke a na-eme mgbe foto ahụ na-edoghị anya ma ọ bụ na o kwekọghị na BVN gị.

Biko nwaa ọzọ ebe a: ${verifyLink}

Mgbe ahụ pịnye DONE.`,
  yo: ({ verifyLink }) => `Hmm, a ko le jẹrisi awọn alaye rẹ. Eyi maa nṣẹlẹ nigbati aworan ko ba ye kedere tabi ko ba baamu BVN rẹ.

Jọwọ gbiyanju lẹẹkansi nibi: ${verifyLink}

Lẹhinna tẹ DONE.`,
}

const STILL_CHECKING_VERIFICATION = {
  en: `Still checking your verification, this usually takes just a moment. Please type DONE again in a minute.`,
  ha: `Muna ci gaba da duba tabbaci, wannan yakan ɗauki ɗan lokaci kaɗan. Da fatan za a sake rubuta DONE bayan minti daya.`,
  ig: `Ka anyị na-elele nkwado gị, nke a na-ewekarị nanị obere oge. Biko pịnye DONE ọzọ ka otu nkeji gachaa.`,
  yo: `A si n ṣayẹwo ijẹrisi rẹ, eyi maa n gba akoko diẹ. Jọwọ tẹ DONE lẹẹkansi ni iṣẹju kan.`,
}

const BANK_VERIFY_ERROR = {
  en: ({ err }) => `We hit a snag verifying your bank details (${err}). Please type DONE again in a moment, or type EDIT to re-enter your details.`,
  ha: ({ err }) => `Mun ci karo da matsala wajen tabbatar da bayanan bankinku (${err}). Da fatan za a sake rubuta DONE bayan ɗan lokaci, ko rubuta EDIT domin sake shigar da bayanai.`,
  ig: ({ err }) => `Anyị enwetara nsogbu na ịkwado nkọwa ụlọ akụ gị (${err}). Biko pịnye DONE ọzọ mgbe obere oge gachara, ma ọ bụ pịnye EDIT iji tinye nkọwa gị ọzọ.`,
  yo: ({ err }) => `A ba ni iṣoro ni jẹrisi awọn alaye banki rẹ (${err}). Jọwọ tẹ DONE lẹẹkansi laipẹ, tabi tẹ EDIT lati tun awọn alaye rẹ tẹ.`,
}

const BANK_NOT_FOUND = {
  en: ({ bankName }) => `We couldn't find a bank matching "${bankName}". Please resend all 6 details with the correct bank name.`,
  ha: ({ bankName }) => `Ba mu sami banki da ya dace da "${bankName}" ba. Da fatan za a sake aika dukkan bayanai 6 tare da sunan banki daidai.`,
  ig: ({ bankName }) => `Anyị achọtaghị ụlọ akụ dabara na "${bankName}". Biko zigharị nkọwa isii ahụ dum na aha ụlọ akụ ziri ezi.`,
  yo: ({ bankName }) => `A ko ri banki ti o baamu "${bankName}". Jọwọ tun gbogbo alaye 6 naa ranṣẹ pẹlu orukọ banki to pe.`,
}

const BANK_SELECTION = {
  en: ({ bankName, numbered }) => `A few banks matched "${bankName}" — which one is it?

${numbered}

Reply with the number.`,
  ha: ({ bankName, numbered }) => `Bankuna kaɗan sun dace da "${bankName}" — wanne ne?

${numbered}

Amsa da lamba.`,
  ig: ({ bankName, numbered }) => `Ụlọ akụ ole na ole dabara na "${bankName}" — kedu nke bụ ya?

${numbered}

Jiri nọmba zaghachi.`,
  yo: ({ bankName, numbered }) => `Awọn banki diẹ baamu "${bankName}" — ewo ni?

${numbered}

Dahun pẹlu nọmba.`,
}

const SELECT_BANK_INVALID = {
  en: ({ numbered }) => `Please reply with just the number of your bank:

${numbered}`,
  ha: ({ numbered }) => `Da fatan za a amsa da lambar bankinku kawai:

${numbered}`,
  ig: ({ numbered }) => `Biko jiri naanị nọmba ụlọ akụ gị zaghachi:

${numbered}`,
  yo: ({ numbered }) => `Jọwọ dahun pẹlu nọmba banki rẹ nikan:

${numbered}`,
}

const SELECT_BANK_ERROR = {
  en: ({ err }) => `We hit a snag verifying that account (${err}). Please reply with the number again, or type MENU to start over.`,
  ha: ({ err }) => `Mun ci karo da matsala wajen tabbatar da wannan asusu (${err}). Da fatan za a sake amsa da lamba, ko rubuta MENU domin sake farawa.`,
  ig: ({ err }) => `Anyị enwetara nsogbu na ịkwado akaụntụ ahụ (${err}). Biko jiri nọmba zaghachi ọzọ, ma ọ bụ pịnye MENU ka ịmalitegharịa.`,
  yo: ({ err }) => `A ba ni iṣoro ni jẹrisi account naa (${err}). Jọwọ tun dahun pẹlu nọmba naa, tabi tẹ MENU lati tun bẹrẹ.`,
}

const PLAN_MESSAGE = {
  en: ({ dailyAmount, totalSavings, commission, payout, bankName, accountNumber, fullName, email, address }) =>
`You're verified! Here's your plan:

Daily amount: N${dailyAmount}
Duration: 30 days
Total savings: N${totalSavings}
MyAjo commission: N${commission}
You will receive: N${payout}

Payout goes to:
${bankName} - ${accountNumber}
Name: ${fullName}
Email: ${email}
Address: ${address}

If this all looks correct, type CONFIRM to activate.
If anything needs fixing, type EDIT to re-enter your details.`,
  ha: ({ dailyAmount, totalSavings, commission, payout, bankName, accountNumber, fullName, email, address }) =>
`An tabbatar da ku! Ga tsarinku:

Adadin kullum: N${dailyAmount}
Tsawon lokaci: kwana 30
Jimlar ajiya: N${totalSavings}
Kuɗin caji na MyAjo: N${commission}
Za ku samu: N${payout}

Kuɗin zai je zuwa:
${bankName} - ${accountNumber}
Suna: ${fullName}
Imel: ${email}
Adireshi: ${address}

Idan komai daidai ne, rubuta CONFIRM domin kunna.
Idan wani abu na bukatar gyara, rubuta EDIT domin sake shigar da bayanai.`,
  ig: ({ dailyAmount, totalSavings, commission, payout, bankName, accountNumber, fullName, email, address }) =>
`Akwadola gị! Nke a bụ atụmatụ gị:

Ego kwa ụbọchị: N${dailyAmount}
Ogologo oge: ụbọchị 30
Nchekwa zuru ezu: N${totalSavings}
Ụgwọ ọrụ MyAjo: N${commission}
Ị ga-enweta: N${payout}

Ego ga-aga na:
${bankName} - ${accountNumber}
Aha: ${fullName}
Email: ${email}
Adreesị: ${address}

Ọ bụrụ na ihe niile ziri ezi, pịnye CONFIRM iji mee ka ọ malite.
Ọ bụrụ na e nwere ihe ị chọrọ imezi, pịnye EDIT itinye nkọwa gị ọzọ.`,
  yo: ({ dailyAmount, totalSavings, commission, payout, bankName, accountNumber, fullName, email, address }) =>
`O ti jẹrisi! Eyi ni eto rẹ:

Iye owo ojoojumọ: N${dailyAmount}
Iye akoko: ọjọ 30
Iye owo lapapọ: N${totalSavings}
Owo iṣẹ MyAjo: N${commission}
Iwọ yoo gba: N${payout}

Owo yoo lọ si:
${bankName} - ${accountNumber}
Orukọ: ${fullName}
Imeeli: ${email}
Adirẹsi: ${address}

Ti gbogbo rẹ ba tọ, tẹ CONFIRM lati mu ṣiṣẹ.
Ti ohunkohun ba nilo atunṣe, tẹ EDIT lati tun awọn alaye rẹ tẹ.`,
}

const CONFIRM_PLAN_PROMPT = {
  en: `Please type CONFIRM to activate your plan, EDIT to fix your details, or CANCEL to start over.`,
  ha: `Da fatan za a rubuta CONFIRM domin kunna tsarinku, EDIT domin gyara bayanai, ko CANCEL domin sake farawa.`,
  ig: `Biko pịnye CONFIRM iji mee ka atụmatụ gị malite, EDIT iji mezie nkọwa gị, ma ọ bụ CANCEL ka ịmalitegharịa.`,
  yo: `Jọwọ tẹ CONFIRM lati mu eto rẹ ṣiṣẹ, EDIT lati tun awọn alaye rẹ tẹ, tabi CANCEL lati tun bẹrẹ.`,
}

const ANCHOR_PROVISION_ERROR = {
  en: ({ err }) => `We hit a snag setting up your deposit account (${err}). Please type CONFIRM again in a moment — if it keeps happening, type HELP to reach support.`,
  ha: ({ err }) => `Mun ci karo da matsala wajen shirya asusun ajiyar ku (${err}). Da fatan za a sake rubuta CONFIRM bayan ɗan lokaci — idan ya ci gaba, rubuta HELP domin isa ga taimako.`,
  ig: ({ err }) => `Anyị enwetara nsogbu na ịhazi akaụntụ nchekwa gị (${err}). Biko pịnye CONFIRM ọzọ mgbe obere oge gachara — ọ bụrụ na ọ na-aga nʼihu, pịnye HELP iji kpọtụrụ enyemaka.`,
  yo: ({ err }) => `A ba ni iṣoro ni to account ifowopamọ rẹ silẹ (${err}). Jọwọ tẹ CONFIRM lẹẹkansi laipẹ — ti o ba n tẹsiwaju, tẹ HELP lati de ọdọ atilẹyin.`,
}

const KYC_PENDING = {
  en: ({ fullName }) => `Thanks ${fullName}! We're verifying your details with our banking partner now — this usually takes a few moments.

We'll message you here the second your savings account is ready. No need to do anything else for now.`,
  ha: ({ fullName }) => `Na gode ${fullName}! Muna tabbatar da bayananku tare da abokin bankinmu yanzu — wannan yakan ɗauki ɗan lokaci kaɗan.

Za mu tuntuɓe ku nan take da zarar asusun ajiyar ku ya shirya. Babu buƙatar yin komai a yanzu.`,
  ig: ({ fullName }) => `Daalụ ${fullName}! Anyị na-akwado nkọwa gị na onye mmekọ akụ na ụba anyị ugbu a — nke a na-ewekarị nanị obere oge.

Anyị ga-ezitere gị ozi ebe a ozugbo akaụntụ nchekwa gị dịla njikere. Ọ dịghị ihe ọzọ ị kwesịrị ime ugbu a.`,
  yo: ({ fullName }) => `E se ${fullName}! A n jẹrisi awọn alaye rẹ pẹlu alabaṣepọ banki wa lọwọlọwọ — eyi maa n gba akoko diẹ.

A yoo fi ranṣẹ si ọ nibi ni kete ti account ifowopamọ rẹ ba ti setan. Ko si nkan miiran ti o nilo lati ṣe fun bayi.`,
}

const EDIT_REDO_DETAILS = {
  en: ({ verifyLink }) => `No problem, let's redo your details.

Please reply with your details in this format (one per line):

Full Name
Email Address
Residential Address (Street, City, State)
Bank Name
Account Number
Daily savings amount (1000-10000)

Example:
Ada Okafor
ada@email.com
12 Market Road, Ikeja, Lagos
GTBank
0123456789
5000

If you still need to verify your identity, do that here too:
${verifyLink}

Once done, type DONE.`,
  ha: ({ verifyLink }) => `Babu matsala, bari mu sake yin bayananku.

Da fatan za a amsa da bayanai a wannan tsari (layi ɗaya-ɗaya):

Cikakken Suna
Adireshin Imel
Adireshin Zama (Titi, Gari, Jiha)
Sunan Banki
Lambar Asusu
Adadin ajiya na yau da kullum (1000-10000)

Misali:
Ada Okafor
ada@email.com
12 Market Road, Ikeja, Lagos
GTBank
0123456789
5000

Idan har kuna bukatar tabbatar da ainihinku, yi haka a nan ma:
${verifyLink}

Idan an gama, rubuta DONE.`,
  ig: ({ verifyLink }) => `Ọ dịghị nsogbu, ka anyị mezigharịa nkọwa gị.

Biko zaghachi nkọwa gị nʼụdị a (otu nʼahịrị ọ bụla):

Aha Zuru Ezu
Adreesị Email
Adreesị Obibi (Okporo ámá, Obodo, Steeti)
Aha Ụlọ Akụ
Nọmba Akaụntụ
Ego ị ga-echekwa kwa ụbọchị (1000-10000)

Ọmụmaatụ:
Ada Okafor
ada@email.com
12 Market Road, Ikeja, Lagos
GTBank
0123456789
5000

Ọ bụrụ na ị ka chọrọ igosi onye ị bụ, mee ya nʼebe a kwa:
${verifyLink}

Ọ bụrụ na emechaala, pịnye DONE.`,
  yo: ({ verifyLink }) => `Ko si isoro, jẹ ki a tun awọn alaye rẹ ṣe.

Jọwọ dahun pẹlu awọn alaye rẹ ni ọna yii (ọkan fun ila kọọkan):

Orukọ Kikun
Imeeli
Adirẹsi Ibugbe (Opopona, Ilu, Ipinlẹ)
Orukọ Banki
Nọmba Account
Iye owo ti o fẹ fi pamọ lojoojumọ (1000-10000)

Àpẹẹrẹ:
Ada Okafor
ada@email.com
12 Market Road, Ikeja, Lagos
GTBank
0123456789
5000

Ti o ba tun nilo lati jẹrisi ẹni ti o jẹ, ṣe bẹ nibi naa:
${verifyLink}

Nigba ti o ba ti ṣe, tẹ DONE.`,
}

const CANCEL_CONFIRMATION = {
  en: `No problem. Type MENU whenever you are ready to start your savings plan.`,
  ha: `Babu matsala. Rubuta MENU duk lokacin da kuka shirya fara tsarin ajiyar ku.`,
  ig: `Ọ dịghị nsogbu. Pịnye MENU mgbe ọ bụla ị dị njikere ịmalite atụmatụ nchekwa gị.`,
  yo: `Ko si isoro. Tẹ MENU nigbakugba ti o ba ti setan lati bẹrẹ eto ifowopamọ rẹ.`,
}

const CYCLE_ACTIVATED = {
  en: ({ name, dailyAmount, accountNumber, isNew }) => `Your savings plan is now active!

${name} your ${isNew ? '' : 'new '}MyAjo journey has begun.

Send your daily savings of N${dailyAmount} to ${isNew ? 'this' : 'your existing'} account:

Account Number: ${accountNumber}
(This is your dedicated MyAjo savings account, held with our licensed banking partner.)

When your transfer goes through, we will confirm it automatically. You can also type PAID anytime to check.

Good luck and stay consistent!`,
  ha: ({ name, dailyAmount, accountNumber, isNew }) => `Tsarin ajiyar ku yanzu yana aiki!

${name} tafiyar ${isNew ? '' : 'sabuwar '}MyAjo ta ku ta fara.

Aika ajiyar ku ta yau da kullum ta N${dailyAmount} zuwa ${isNew ? 'wannan' : 'asusun ku na yanzu'}:

Lambar Asusu: ${accountNumber}
(Wannan shine keɓantaccen asusun ajiyar MyAjo, wanda abokin bankinmu mai lasisi ke rikewa.)

Da zarar canja wurin ya tafi, za mu tabbatar da shi kai tsaye. Hakanan za ku iya rubuta PAID a kowane lokaci domin bincika.

Sa'a mai kyau, ku ci gaba da tsayawa tsayin daka!`,
  ig: ({ name, dailyAmount, accountNumber, isNew }) => `Atụmatụ nchekwa gị na-arụ ọrụ ugbu a!

${name} njem MyAjo ${isNew ? '' : 'ọhụrụ '}gị amalitela.

Ziga ego nchekwa gị kwa ụbọchị nke N${dailyAmount} na akaụntụ ${isNew ? 'a' : 'gị dị adị'}:

Nọmba Akaụntụ: ${accountNumber}
(Nke a bụ akaụntụ nchekwa MyAjo raara nye gị, nke onye mmekọ akụ na ụba anyị nwere ikike na-edebe.)

Ozugbo ego gị agafere, anyị ga-akwado ya na akpaaka. Ị nwekwara ike pịnye PAID mgbe ọ bụla iji lelee.

Ihu ọma, gaa nʼihu na-adịgide!`,
  yo: ({ name, dailyAmount, accountNumber, isNew }) => `Eto ifowopamọ rẹ ti n ṣiṣẹ bayi!

${name} irin-ajo MyAjo ${isNew ? '' : 'tuntun '}rẹ ti bẹrẹ.

Fi owo ifowopamọ ojoojumọ rẹ ti N${dailyAmount} ranṣẹ si ${isNew ? 'account yii' : 'account rẹ to wa tẹlẹ'}:

Nọmba Account: ${accountNumber}
(Eyi ni account ifowopamọ MyAjo rẹ pataki, ti alabaṣepọ banki wa to ni iwe-aṣẹ n dani mu.)

Nigba ti owo rẹ ba ti wọle, a yoo jẹrisi rẹ laifọwọyi. O tun le tẹ PAID nigbakugba lati ṣayẹwo.

Oriire, jọwọ maa duro sinsin!`,
}

const AWAITING_KYC_WAITING = {
  en: `Still verifying your details with our banking partner — almost there. We'll message you here as soon as your savings account is ready.`,
  ha: `Muna ci gaba da tabbatar da bayananku tare da abokin bankinmu — kusan mun kammala. Za mu tuntuɓe ku nan take da zarar asusun ajiyar ku ya shirya.`,
  ig: `Ka anyị na-akwado nkọwa gị na onye mmekọ akụ na ụba anyị — anyị fọrọ nke nta. Anyị ga-ezitere gị ozi ebe a ozugbo akaụntụ nchekwa gị dịla njikere.`,
  yo: `A si n jẹrisi awọn alaye rẹ pẹlu alabaṣepọ banki wa — o fẹrẹ pari. A yoo fi ranṣẹ si ọ nibi ni kete ti account ifowopamọ rẹ ba ti setan.`,
}

const AWAITING_KYC_REJECTED = {
  en: `We could not verify your details with our banking partner. This usually happens if your name, phone number, or BVN details don't match. Please contact support at hello@myajo.com.ng and we will help sort this out.`,
  ha: `Ba mu iya tabbatar da bayananku tare da abokin bankinmu ba. Wannan yakan faru idan suna, lambar waya, ko bayanan BVN naku basu dace ba. Da fatan za a tuntuɓi taimako a hello@myajo.com.ng za mu taimaka warware wannan.`,
  ig: `Anyị enwekwaghị ike ikwado nkọwa gị na onye mmekọ akụ na ụba anyị. Nke a na-emekarị ma ọ bụrụ na aha gị, nọmba ekwentị, ma ọ bụ nkọwa BVN gị adabaghị. Biko kpọtụrụ enyemaka na hello@myajo.com.ng anyị ga-enyere gị aka idozi nke a.`,
  yo: `A ko le jẹrisi awọn alaye rẹ pẹlu alabaṣepọ banki wa. Eyi maa nṣẹlẹ ti orukọ, nọmba foonu, tabi alaye BVN rẹ ko ba baamu. Jọwọ kan si atilẹyin ni hello@myajo.com.ng a yoo ran ọ lọwọ lati yanju eyi.`,
}

const CYCLE_COMPLETE_PROMPT = {
  en: `Type YES to start a new 30-day savings cycle, or MENU to see all options.`,
  ha: `Rubuta YES domin fara sabon zubi na kwana 30, ko MENU domin ganin dukkan zaɓuka.`,
  ig: `Pịnye YES iji malite usoro nchekwa ego ọhụrụ nke ụbọchị 30, ma ọ bụ MENU iji hụ nhọrọ niile.`,
  yo: `Tẹ YES lati bẹrẹ ipe ifowopamọ tuntun ti ọjọ 30, tabi MENU lati wo gbogbo aṣayan.`,
}

const NEW_CYCLE_AMOUNT_PROMPT = {
  en: `How much would you like to save daily? (N1,000 - N10,000)`,
  ha: `Nawa kake son adana kullum? (N1,000 - N10,000)`,
  ig: `Ego ole ka ị chọrọ ịchekwa kwa ụbọchị? (N1,000 - N10,000)`,
  yo: `Elo ni o fẹ fi pamọ lojoojumọ? (N1,000 - N10,000)`,
}

const NEW_CYCLE_ACCOUNT_ERROR = {
  en: `Something went wrong finding your account details. Please type MENU to start over, or contact support at hello@myajo.com.ng.`,
  ha: `Wani abu ya faru ba daidai ba wajen samun bayanan asusunku. Da fatan za a rubuta MENU domin sake farawa, ko tuntuɓi taimako a hello@myajo.com.ng.`,
  ig: `Ihe adịghị mma mere na ịchọta nkọwa akaụntụ gị. Biko pịnye MENU ka ịmalitegharịa, ma ọ bụ kpọtụrụ enyemaka na hello@myajo.com.ng.`,
  yo: `Nkan kan ṣẹlẹ ti ko tọ ni wiwa awọn alaye account rẹ. Jọwọ tẹ MENU lati tun bẹrẹ, tabi kan si atilẹyin ni hello@myajo.com.ng.`,
}

const HOW_IT_WORKS = {
  en: ({ exampleCommission, examplePayout }) => `How MyAjo Works

MyAjo is a digital daily savings platform built on the trusted ajo tradition.

1. You choose how much to save every day
2. You save daily for 30 days
3. At the end of 30 days you collect your full savings minus MyAjo's commission

Example:
Save N1,000 every day
Total after 30 days: N30,000
MyAjo commission: N${exampleCommission}
You receive: N${examplePayout}

Need your money before 30 days? You can withdraw anytime after day 10 — a small fee from our banking partner applies (N50 for withdrawals up to N10,000, N100 above that). MyAjo never charges you extra for this.

Your money is safe and held by our licensed banking partner.

Type 1 to start saving today.`,
  ha: ({ exampleCommission, examplePayout }) => `Yadda MyAjo Yake Aiki

MyAjo dandali ne na ajiya ta yau da kullum na dijital wanda aka gina bisa al'adar adashe amintacce.

1. Kuna zaɓar nawa za ku adana kowace rana
2. Kuna adanawa kullum na kwana 30
3. Bayan kwana 30, za ku karɓi cikakkiyar ajiyar ku ban da kuɗin caji na MyAjo

Misali:
Adana N1,000 kowace rana
Jimla bayan kwana 30: N30,000
Kuɗin caji na MyAjo: N${exampleCommission}
Za ku karɓa: N${examplePayout}

Kuna bukatar kuɗin ku kafin kwana 30? Kuna iya cirewa a kowane lokaci bayan rana ta 10 — ƙaramin caji daga abokin bankinmu zai shafi (N50 don cirewa har zuwa N10,000, N100 sama da haka). MyAjo baya ƙara komai a kai kai tsaye.

Kuɗin ku amintacce ne kuma abokin bankinmu mai lasisi ne ke rikewa.

Rubuta 1 domin fara adanawa yau.`,
  ig: ({ exampleCommission, examplePayout }) => `Otu MyAjo Si Arụ Ọrụ

MyAjo bụ ikpo okwu nchekwa ego kwa ụbọchị nke dijitalụ, e wuru na omenala ajo a tụkwasịrị obi.

1. Ị họrọ ego ole ị ga-echekwa kwa ụbọchị
2. Ị na-echekwa ya kwa ụbọchị ruo ụbọchị 30
3. Na njedebe ụbọchị 30, ị na-anata nchekwa gị dum wepụrụ ụgwọ ọrụ MyAjo

Ọmụmaatụ:
Chekwaa N1,000 kwa ụbọchị
Ngụkọta mgbe ụbọchị 30 gasịrị: N30,000
Ụgwọ ọrụ MyAjo: N${exampleCommission}
Ị ga-enweta: N${examplePayout}

Ị chọrọ ego gị tupu ụbọchị 30? Ị nwere ike wepụ mgbe ọ bụla mgbe ụbọchị nke 10 gasịrị — obere ụgwọ site nʼaka onye mmekọ akụ na ụba anyị na-adabara (N50 maka iwepụ ruo N10,000, N100 karịa nke ahụ). MyAjo anaghị agbakwunye ihe ọ bụla na elu nke a.

Ego gị dị nchebe, onye mmekọ akụ na ụba anyị nwere ikike na-edebekwa ya.

Pịnye 1 iji malite ịchekwa taa.`,
  yo: ({ exampleCommission, examplePayout }) => `Bi MyAjo Ṣe Nṣiṣẹ

MyAjo jẹ ẹrọ ifowopamọ ojoojumọ oni-nọmba ti a kọ lori aṣa ajo ti a gbẹkẹle.

1. O yan iye ti o fẹ fi pamọ lojoojumọ
2. O n fi owo pamọ lojoojumọ fun ọjọ 30
3. Ni opin ọjọ 30, o gba gbogbo ifowopamọ rẹ yato si owo iṣẹ MyAjo

Àpẹẹrẹ:
Fi N1,000 pamọ lojoojumọ
Lapapọ lẹhin ọjọ 30: N30,000
Owo iṣẹ MyAjo: N${exampleCommission}
Iwọ yoo gba: N${examplePayout}

O nilo owo rẹ ki ọjọ 30 to pari? O le yọ owo nigbakugba lẹhin ọjọ 10 — owo kekere lati ọdọ alabaṣepọ banki wa yoo kan (N50 fun yiyọ owo to N10,000, N100 to ba ju bẹẹ lọ). MyAjo ko gba owo eyikeyi mikun fun eyi.

Owo rẹ wa ni aabo, alabaṣepọ banki wa to ni iwe-aṣẹ ni n dani mu.

Tẹ 1 lati bẹrẹ fifi owo pamọ loni.`,
}

const SUPPORT_MESSAGE = {
  en: `Support

To speak with our support team please send an email to hello@myajo.com.ng or call 08029708278 during business hours Monday to Friday 8am to 5pm.

Type MENU to return to the main menu.`,
  ha: `Taimako

Domin yin magana da ƙungiyar taimakonmu, da fatan za a aika imel zuwa hello@myajo.com.ng ko a kira 08029708278 a lokutan aiki Litinin zuwa Jumma'a karfe 8 na safe zuwa 5 na yamma.

Rubuta MENU domin komawa babban jerin.`,
  ig: `Enyemaka

Iji kwuo okwu na ndị otu enyemaka anyị, biko zipu email na hello@myajo.com.ng ma ọ bụ kpọọ 08029708278 nʼoge azụmahịa Mọnde ruo Fraịde elekere 8 nʼụtụtụ ruo 5 nʼanyasị.

Pịnye MENU ka ịlaghachi na ndepụta izugbe.`,
  yo: `Atilẹyin

Lati ba ẹgbẹ atilẹyin wa sọrọ, jọwọ fi imeeli ranṣẹ si hello@myajo.com.ng tabi pe 08029708278 ni akoko iṣẹ Ọjọ Aje si Ẹtì, aago 8 owurọ si aago 5 alẹ.

Tẹ MENU lati pada si akojọ akọkọ.`,
}

const MAIN_MENU_INVALID = {
  en: `Please reply with a number between 1 and 4 to choose an option.

1. Start Daily Savings
2. Check My Balance
3. Learn How It Works
4. Speak with Support`,
  ha: `Da fatan za a amsa da lamba tsakanin 1 zuwa 4 domin zaɓar wani abu.

1. Fara Ajiya ta Yau da Kullum
2. Duba Ajiyar Ku
3. Fahimtar Yadda Yake Aiki
4. Yi Magana da Taimako`,
  ig: `Biko jiri nọmba dị nʼetiti 1 na 4 zaghachi iji họrọ nhọrọ.

1. Malite Nchekwa Kwa Ụbọchị
2. Lelee Ego M
3. Mụta Otu Ọ Si Arụ Ọrụ
4. Kpọtụrụ Enyemaka`,
  yo: `Jọwọ dahun pẹlu nọmba laarin 1 si 4 lati yan aṣayan kan.

1. Bẹrẹ Ifowopamọ Ojoojumọ
2. Wo Iye Owo Mi
3. Kọ Bi O Ṣe Nṣiṣẹ
4. Ba Atilẹyin Sọrọ`,
}

const RECONNECT_PROMPT = {
  en: ({ verifyLink }) => `No problem — verify your identity here and we'll reconnect your MyAjo account to this number automatically:

${verifyLink}

This takes about a minute. You don't need to re-enter any other details — once verification completes, we'll message you here.`,
  ha: ({ verifyLink }) => `Babu matsala — tabbatar da ainihin ku a nan sannan za mu haɗa asusunku na MyAjo zuwa wannan lambar kai tsaye:

${verifyLink}

Wannan yana ɗaukar minti daya kacal. Ba kwa buƙatar sake shigar da wasu bayanai — da zarar tabbaci ya kammala, za mu tuntuɓe ku nan.`,
  ig: ({ verifyLink }) => `Ọ dịghị nsogbu — gosi onye ị bụ ebe a anyị ga-ejikọtakwa akaụntụ MyAjo gị na nọmba a na akpaaka:

${verifyLink}

Nke a na-ewe ihe dị ka otu nkeji. Ị dịghị mkpa itinye nkọwa ọzọ ọ bụla — ozugbo nkwado agwụsịrị, anyị ga-ezitere gị ozi ebe a.`,
  yo: ({ verifyLink }) => `Ko si isoro — jẹrisi ẹni ti o jẹ nibi a yoo si tun so account MyAjo rẹ mọ nọmba yii laifọwọyi:

${verifyLink}

Eyi yoo gba iṣẹju kan. O ko nilo lati tun eyikeyi alaye miiran tẹ — ni kete ti ijẹrisi ba pari, a yoo fi ranṣẹ si ọ nibi.`,
}

const RECONNECT_WAITING = {
  en: ({ verifyLink }) => `Still waiting on your verification to complete. If you haven't opened the link yet, here it is again:

${verifyLink}

Once it's done, we'll message you here automatically — no need to type anything further.`,
  ha: ({ verifyLink }) => `Muna jira tabbacin ku ya kammala. Idan har ba ku buɗe hanyar haɗin ba tukuna, ga shi kuma:

${verifyLink}

Da zarar an gama, za mu tuntuɓe ku nan kai tsaye — babu buƙatar sake rubuta komai.`,
  ig: ({ verifyLink }) => `Ka anyị na-echere ka nkwado gị gwụsịa. Ọ bụrụ na ị meghebeghị njikọ ahụ, ọ dị ebe a ọzọ:

${verifyLink}

Ozugbo emechara, anyị ga-ezitere gị ozi ebe a na akpaaka — ọ dịghị mkpa ịpịnye ihe ọzọ ọ bụla.`,
  yo: ({ verifyLink }) => `A si n duro de ijẹrisi rẹ lati pari. Ti o ko ba tii ṣi ọna asopọ naa, eyi niyi lẹẹkansi:

${verifyLink}

Nigba ti o ba ti pari, a yoo fi ranṣẹ si ọ nibi laifọwọyi — ko si iwulo lati tun nkankan tẹ mọ.`,
}

const NO_ACCOUNT_FOUND = {
  en: `I could not find your account. Type MENU to get started.`,
  ha: `Ban sami asusunku ba. Rubuta MENU domin fara.`,
  ig: `Anaghị m achọta akaụntụ gị. Pịnye MENU ka ịmalite.`,
  yo: `Mi o ri account rẹ. Tẹ MENU lati bẹrẹ.`,
}

const NO_ACTIVE_CYCLE_GENERIC = {
  en: `You do not have an active savings cycle. Type 1 to start one.`,
  ha: `Ba ku da zubi mai aiki. Rubuta 1 domin fara ɗaya.`,
  ig: `Ị nweghị usoro nchekwa ego na-arụ ọrụ. Pịnye 1 ka ị malite otu.`,
  yo: `O ko ni ipe ifowopamọ to n ṣiṣẹ. Tẹ 1 lati bẹrẹ ọkan.`,
}

const NO_ACTIVE_CYCLE_BALANCE = {
  en: `You do not have an active savings cycle.

Type 1 to start saving today.`,
  ha: `Ba ku da zubi mai aiki.

Rubuta 1 domin fara ajiya yau.`,
  ig: `Ị nweghị usoro nchekwa ego na-arụ ọrụ.

Pịnye 1 ka ịmalite ịchekwa taa.`,
  yo: `O ko ni ipe ifowopamọ to n ṣiṣẹ.

Tẹ 1 lati bẹrẹ fifi owo pamọ loni.`,
}

const PAID_NOT_RECEIVED = {
  en: `We haven't received your transfer yet. Bank transfers can take a few minutes to reflect — Temi will confirm automatically as soon as it comes in. If it's been more than 30 minutes, type HELP to contact support.`,
  ha: `Ba mu karɓi canja wurin ku ba tukuna. Canja wurin banki na iya ɗaukar mintuna kaɗan kafin ya bayyana — Temi zai tabbatar kai tsaye da zarar ya shigo. Idan ya wuce minti 30, rubuta HELP domin tuntuɓar taimako.`,
  ig: `Anyị enwetabeghị mbufe gị. Mbufe ụlọ akụ nwere ike were nkeji ole na ole tupu ọ pụta — Temi ga-akwado ya na akpaaka ozugbo ọ batara. Ọ bụrụ na ọ gafeela nkeji 30, pịnye HELP iji kpọtụrụ enyemaka.`,
  yo: `A ko tii gba owo ti o ranṣẹ. Gbigbe owo banki le gba iṣẹju diẹ lati han — Temi yoo jẹrisi laifọwọyi ni kete ti o ba wọle. Ti o ba ti ju iṣẹju 30 lọ, tẹ HELP lati kan si atilẹyin.`,
}

const SAVE_DEPRECATED = {
  en: `We've simplified this — you no longer need to send a reference number. Just make your transfer, then reply PAID and Temi will confirm it for you.`,
  ha: `Mun sauƙaƙe wannan — ba kwa buƙatar sake aika lambar tunani. Kawai ku yi canja wuri, sannan ku rubuta PAID Temi zai tabbatar muku.`,
  ig: `Anyị emeela ka nke a dị mfe — ị chọghịzi izipu nọmba ntụaka. Naanị mee mbufe gị, mgbe ahụ zaghachi PAID Temi ga-akwado ya nye gị.`,
  yo: `A ti ṣe eyi ni irorun — o ko nilo lati fi nọmba itọkasi ranṣẹ mọ. Kan gbe owo rẹ, lẹhinna dahun PAID Temi yoo jẹrisi rẹ fun ọ.`,
}

const WITHDRAW_USAGE = {
  en: `To withdraw, send WITHDRAW followed by the amount.

Example: WITHDRAW 5000`,
  ha: `Domin cirewa, aika WITHDRAW sannan adadin.

Misali: WITHDRAW 5000`,
  ig: `Iji wepụ ego, zipu WITHDRAW gbakwunyere ọnụọgụ ahụ.

Ọmụmaatụ: WITHDRAW 5000`,
  yo: `Lati yọ owo, fi WITHDRAW ranṣẹ pẹlu iye owo.

Àpẹẹrẹ: WITHDRAW 5000`,
}

const WITHDRAWAL_CANCELLED = {
  en: `Withdrawal cancelled. Your savings are untouched.`,
  ha: `An soke cirewa. Ajiyar ku ba a taba ba.`,
  ig: `Akagbuola iwepụ ego. Emetụghị nchekwa gị aka.`,
  yo: `A ti fagile yiyọ owo. Ifowopamọ rẹ ko yipada.`,
}

const WITHDRAWAL_FAILED = {
  en: ({ reason }) => `Withdrawal could not be completed: ${reason}`,
  ha: ({ reason }) => `Ba a iya kammala cirewa ba: ${reason}`,
  ig: ({ reason }) => `Enweghị ike imecha iwepụ ego: ${reason}`,
  yo: ({ reason }) => `Ko le pari yiyọ owo: ${reason}`,
}

const WITHDRAWAL_SUCCESS = {
  en: ({ netAmount }) => `N${netAmount} is on its way to your account.`,
  ha: ({ netAmount }) => `N${netAmount} yana kan hanya zuwa asusun ku.`,
  ig: ({ netAmount }) => `N${netAmount} na-aga akaụntụ gị.`,
  yo: ({ netAmount }) => `N${netAmount} n bọ si account rẹ.`,
}

const WITHDRAWAL_CYCLE_ENDED = {
  en: ({ netAmount }) => `N${netAmount} is on its way to your account.

Your savings cycle has ended.

Ready to begin your next cycle? Type YES.`,
  ha: ({ netAmount }) => `N${netAmount} yana kan hanya zuwa asusun ku.

Zubin ajiyar ku ya ƙare.

A shirye don fara sabon zubi? Rubuta YES.`,
  ig: ({ netAmount }) => `N${netAmount} na-aga akaụntụ gị.

Usoro nchekwa ego gị agwụla.

Adịla njikere ịmalite usoro ọzọ? Pịnye YES.`,
  yo: ({ netAmount }) => `N${netAmount} n bọ si account rẹ.

Ipe ifowopamọ rẹ ti pari.

Ti ṣetan lati bẹrẹ ipe tuntun? Tẹ YES.`,
}

const FREEZE_NO_ACCOUNT = {
  en: `I could not find your account. Please contact support immediately.`,
  ha: `Ban sami asusunku ba. Da fatan za a tuntuɓi taimako nan take.`,
  ig: `Anaghị m achọta akaụntụ gị. Biko kpọtụrụ enyemaka ozugbo.`,
  yo: `Mi o ri account rẹ. Jọwọ kan si atilẹyin lẹsẹkẹsẹ.`,
}

const FREEZE_CONFIRMATION = {
  en: ({ name }) => `Your MyAjo account has been frozen immediately ${name}. No transactions can be made until you contact our support team to unfreeze it.

Contact us at hello@myajo.com.ng or call 08029708278.`,
  ha: ({ name }) => `An dakatar da asusun MyAjo naku nan take ${name}. Ba za a iya yin kowace mu'amala ba har sai kun tuntuɓi ƙungiyar taimakonmu domin sake buɗe shi.

Tuntuɓe mu a hello@myajo.com.ng ko ku kira 08029708278.`,
  ig: ({ name }) => `Akwụsịla akaụntụ MyAjo gị ozugbo ${name}. Enweghị azụmahịa a ga-eme ruo mgbe ị kpọtụrụ ndị otu enyemaka anyị ka ha meghee ya ọzọ.

Kpọtụrụ anyị na hello@myajo.com.ng ma ọ bụ kpọọ 08029708278.`,
  yo: ({ name }) => `Account MyAjo rẹ ti duro lẹsẹkẹsẹ ${name}. Ko si iṣowo ti o le ṣe titi iwọ o fi kan si ẹgbẹ atilẹyin wa lati ṣi i.

Kan si wa ni hello@myajo.com.ng tabi pe 08029708278.`,
}

const FALLBACK_NOT_UNDERSTOOD = {
  en: `I did not understand that. Type MENU to see your options or HELP to see all commands.`,
  ha: `Ban fahimci hakan ba. Rubuta MENU domin ganin zaɓukanku ko HELP domin ganin dukkan umarni.`,
  ig: `Aghọtaghị m nke ahụ. Pịnye MENU iji hụ nhọrọ gị ma ọ bụ HELP iji hụ iwu niile.`,
  yo: `Mi o gbọye iyẹn. Tẹ MENU lati wo aṣayan rẹ tabi HELP lati wo gbogbo aṣẹ.`,
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
// account, since it's the total minus the flat-fee commission for
// their tier, not the full savings figure. Worth keeping for trust
// and to head off support messages asking "why is this less than I saved".
const CYCLE_COMPLETE = {
  en: ({ totalSaved, commission, netPayout }) =>
`🎉 *Congratulations!*

You completed your 30-day savings cycle.

Savings:
₦${totalSaved}

MyAjo commission:
₦${commission}

Your payout of ₦${netPayout} has been sent.

Ready to begin your next cycle? Type YES.`,
}

export function getMessage(key, lang, params = {}) {
  const safeLang = ['en', 'ha', 'ig', 'yo'].includes(lang) ? lang : 'en'
  const pick = (obj) => (typeof obj[safeLang] === 'function' ? obj[safeLang](params) : (obj[safeLang] || obj.en))

  if (key === 'welcome') return WELCOME[safeLang].replace('{disclaimer}', DISCLAIMER[safeLang])
  if (key === 'help') return HELP[safeLang].replace('{disclaimer}', DISCLAIMER[safeLang])
  if (key === 'balance') return BALANCE[safeLang](params)
  if (key === 'contribution_recorded') return CONTRIBUTION_RECORDED.en(params)
  if (key === 'daily_reminder') return DAILY_REMINDER.en(params)
  if (key === 'cycle_complete') return CYCLE_COMPLETE.en(params)

  if (key === 'active_cycle_exists') return pick(ACTIVE_CYCLE_EXISTS)
  if (key === 'returning_trader_new_cycle') return pick(RETURNING_TRADER_NEW_CYCLE)
  if (key === 'onboarding_intro') return pick(ONBOARDING_INTRO)
  if (key === 'onboarding_details_missing') return pick(ONBOARDING_DETAILS_MISSING)
  if (key === 'verification_failed') return pick(VERIFICATION_FAILED)
  if (key === 'still_checking_verification') return pick(STILL_CHECKING_VERIFICATION)
  if (key === 'bank_verify_error') return pick(BANK_VERIFY_ERROR)
  if (key === 'bank_not_found') return pick(BANK_NOT_FOUND)
  if (key === 'bank_selection') return pick(BANK_SELECTION)
  if (key === 'select_bank_invalid') return pick(SELECT_BANK_INVALID)
  if (key === 'select_bank_error') return pick(SELECT_BANK_ERROR)
  if (key === 'plan_message') return pick(PLAN_MESSAGE)
  if (key === 'confirm_plan_prompt') return pick(CONFIRM_PLAN_PROMPT)
  if (key === 'anchor_provision_error') return pick(ANCHOR_PROVISION_ERROR)
  if (key === 'kyc_pending') return pick(KYC_PENDING)
  if (key === 'edit_redo_details') return pick(EDIT_REDO_DETAILS)
  if (key === 'cancel_confirmation') return pick(CANCEL_CONFIRMATION)
  if (key === 'cycle_activated') return pick(CYCLE_ACTIVATED)
  if (key === 'awaiting_kyc_waiting') return pick(AWAITING_KYC_WAITING)
  if (key === 'awaiting_kyc_rejected') return pick(AWAITING_KYC_REJECTED)
  if (key === 'cycle_complete_prompt') return pick(CYCLE_COMPLETE_PROMPT)
  if (key === 'new_cycle_amount_prompt') return pick(NEW_CYCLE_AMOUNT_PROMPT)
  if (key === 'new_cycle_account_error') return pick(NEW_CYCLE_ACCOUNT_ERROR)
  if (key === 'how_it_works') return pick(HOW_IT_WORKS)
  if (key === 'support_message') return pick(SUPPORT_MESSAGE)
  if (key === 'main_menu_invalid') return pick(MAIN_MENU_INVALID)
  if (key === 'reconnect_prompt') return pick(RECONNECT_PROMPT)
  if (key === 'reconnect_waiting') return pick(RECONNECT_WAITING)
  if (key === 'no_account_found') return pick(NO_ACCOUNT_FOUND)
  if (key === 'no_active_cycle_generic') return pick(NO_ACTIVE_CYCLE_GENERIC)
  if (key === 'no_active_cycle_balance') return pick(NO_ACTIVE_CYCLE_BALANCE)
  if (key === 'paid_not_received') return pick(PAID_NOT_RECEIVED)
  if (key === 'save_deprecated') return pick(SAVE_DEPRECATED)
  if (key === 'withdraw_usage') return pick(WITHDRAW_USAGE)
  if (key === 'withdrawal_cancelled') return pick(WITHDRAWAL_CANCELLED)
  if (key === 'withdrawal_failed') return pick(WITHDRAWAL_FAILED)
  if (key === 'withdrawal_success') return pick(WITHDRAWAL_SUCCESS)
  if (key === 'withdrawal_cycle_ended') return pick(WITHDRAWAL_CYCLE_ENDED)
  if (key === 'freeze_no_account') return pick(FREEZE_NO_ACCOUNT)
  if (key === 'freeze_confirmation') return pick(FREEZE_CONFIRMATION)
  if (key === 'fallback_not_understood') return pick(FALLBACK_NOT_UNDERSTOOD)

  return null
}
