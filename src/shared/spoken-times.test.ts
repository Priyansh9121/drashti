import { describe, expect, it } from 'vitest';
import { normalizeSpokenTimes } from './spoken-times';

/*
 * QA24-CAPLANG-2e (alpha.24, the owner's answer: "spoken times into digits first"): a caption phrase's times said in
 * words become digits before the phrase is translated. In a24-caplang2's reading of 336 translations, 7 of the 9
 * critical errors were times said in words ("sava aath", 8:15, came out as 8:30); written as digits, 36 of 36 came
 * through right. Placeholder sentences only (a bus, a meeting, a room, as the captions bench's), never mandir content.
 *
 * Each row: what the captions heard, what goes to the translator, and why. A row whose two texts are the same is a
 * negative: nothing in it is a time said in words, or it is not sure enough to change (accuracy before coverage).
 * Rows marked UNSURE are left as spoken on purpose, for the owner's reader to check.
 */

type Row = readonly [heard: string, toTranslate: string, why: string];

/** साढ़े and डेढ़ with the nukta as its own code point (NFC), and with the one-code-point letter (U+095D). */
const SAADHE = 'साढ़े';
const SAADHE_ONE = 'साढ़े';
const DEDH = 'डेढ़';
const DEDH_ONE = 'डेढ़';
/** घड़ी with the one-code-point ड़ (U+095C): the words around a time are kept exactly as they came. */
const GHADI_ONE = 'घड़ी';

const GUJARATI: readonly Row[] = [
  // Quarter words with an hour and a clock word: the bench's own sentences first.
  [
    'આગામી બસ સવારે સવા આઠ વાગ્યે આવશે.',
    'આગામી બસ સવારે 8:15 વાગ્યે આવશે.',
    'sava: a quarter past; savare stays',
  ],
  ['બેઠક બપોરે સાડા બાર વાગ્યે શરૂ થશે.', 'બેઠક બપોરે 12:30 વાગ્યે શરૂ થશે.', 'sadha: half past'],
  [
    'ઘડિયાળમાં પોણા પાંચ વાગ્યા છે અને બસ તૈયાર છે.',
    'ઘડિયાળમાં 4:45 વાગ્યા છે અને બસ તૈયાર છે.',
    'pona: a quarter to',
  ],
  ['આજે માહિતી કક્ષ સાંજે છ વાગ્યે બંધ થશે.', 'આજે માહિતી કક્ષ સાંજે 6 વાગ્યે બંધ થશે.', 'an hour, vagye'],
  ['ભોજન દોઢ વાગ્યે શરૂ થશે.', 'ભોજન 1:30 વાગ્યે શરૂ થશે.', 'dodh: half past one'],
  ['બસ અઢી વાગ્યે ઊપડશે.', 'બસ 2:30 વાગ્યે ઊપડશે.', 'adhi: half past two'],
  ['દરવાજો પોણા એક વાગ્યે ખૂલશે.', 'દરવાજો 12:45 વાગ્યે ખૂલશે.', 'pona ek: a quarter to one'],
  ['સભા સવા બાર વાગ્યે પૂરી થશે.', 'સભા 12:15 વાગ્યે પૂરી થશે.', 'sava bar'],
  ['સવા એક વાગ્યે ચા મળશે.', '1:15 વાગ્યે ચા મળશે.', 'sava ek, first in the phrase'],
  ['પોણા નવ વાગ્યે બસ આવશે.', '8:45 વાગ્યે બસ આવશે.', 'pona nav'],
  ['સાડા અગિયાર વાગ્યે વિરામ છે.', '11:30 વાગ્યે વિરામ છે.', 'agiyar'],
  ['સાડા અગ્યાર વાગ્યે વિરામ છે.', '11:30 વાગ્યે વિરામ છે.', 'agyar, the other spelling'],
  ['દશ વાગ્યે સભા છે.', '10 વાગ્યે સભા છે.', 'dash, the other spelling of das'],
  ['સાડા 7 વાગ્યે બસ આવશે.', '7:30 વાગ્યે બસ આવશે.', 'the hour heard as a digit'],
  ['સવા ૮ વાગ્યે બસ આવશે.', '8:15 વાગ્યે બસ આવશે.', 'the hour as a Gujarati digit'],
  // An hour and minutes.
  ['આઠ વાગીને પંદર મિનિટે બસ આવશે.', '8:15 વાગ્યે બસ આવશે.', 'X vagine Y minite (at): vagye, as measured'],
  ['હવે નવ વાગીને પાંચ મિનિટ થઈ છે.', 'હવે 9:05 થઈ છે.', 'X vagine Y minit'],
  ['સાત વાગીને પિસ્તાલીસ મિનિટે બારણું બંધ થશે.', '7:45 વાગ્યે બારણું બંધ થશે.', 'forty-five minutes'],
  ['આઠ વાગીને 20 મિનિટે બસ આવશે.', '8:20 વાગ્યે બસ આવશે.', 'the minutes heard as digits'],
  // An hour and the clock word's other forms.
  ['દસ વાગ્યાની બસ મોડી છે.', '10 વાગ્યાની બસ મોડી છે.', 'vagyani: the ten o’clock bus'],
  ['સભા અગિયાર વાગે શરૂ થશે.', 'સભા 11 વાગે શરૂ થશે.', 'vage'],
  ['કાઉન્ટર બાર વાગ્યા સુધી ખુલ્લું છે.', 'કાઉન્ટર 12 વાગ્યા સુધી ખુલ્લું છે.', 'vagya sudhi: until twelve'],
  ['એક વાગ્યો છે.', '1 વાગ્યો છે.', 'vagyo'],
  ['ત્રણ વાગશે ત્યારે બસ આવશે.', '3 વાગશે ત્યારે બસ આવશે.', 'vagshe'],
  [
    'પાંચ વાગવામાં દસ મિનિટ બાકી છે.',
    '5 વાગવામાં દસ મિનિટ બાકી છે.',
    'the hour only: ten minutes is a length',
  ],
  // Two times in a phrase, and punctuation around one.
  [
    'સાત વાગ્યાથી સાડા આઠ વાગ્યા સુધી વર્ગ છે.',
    '7 વાગ્યાથી 8:30 વાગ્યા સુધી વર્ગ છે.',
    'from one time until another',
  ],
  [
    'સવારે સાત વાગ્યે નાસ્તો અને સાડા નવ વાગ્યે સભા.',
    'સવારે 7 વાગ્યે નાસ્તો અને 9:30 વાગ્યે સભા.',
    'two times in one phrase',
  ],
  ['હા, સાડા છ વાગ્યે.', 'હા, 6:30 વાગ્યે.', 'after a comma, before a full stop'],
  // Negatives: numbers that are not times, and words not sure enough to change.
  ['રૂમ નંબર બાર બીજા માળે છે.', 'રૂમ નંબર બાર બીજા માળે છે.', 'a room number'],
  ['લાલ ડબ્બામાં ત્રણ નાના દડા મૂકો.', 'લાલ ડબ્બામાં ત્રણ નાના દડા મૂકો.', 'a count'],
  ['લીલી ટોપલીમાં ચાર સફરજન અને બે કેળાં છે.', 'લીલી ટોપલીમાં ચાર સફરજન અને બે કેળાં છે.', 'counts'],
  ['સાડા ત્રણ કિલો ચોખા લાવો.', 'સાડા ત્રણ કિલો ચોખા લાવો.', 'sadha with a weight'],
  ['આ કામમાં દોઢ કલાક લાગશે.', 'આ કામમાં દોઢ કલાક લાગશે.', 'dodh with hours: a length'],
  ['ત્યાં સવા સો ખુરશી છે.', 'ત્યાં સવા સો ખુરશી છે.', 'sava so: 125 chairs'],
  ['પોણો કલાક રાહ જુઓ.', 'પોણો કલાક રાહ જુઓ.', 'pono kalak: three quarters of an hour'],
  ['સાડા વાગ્યે ચા મળશે.', 'સાડા વાગ્યે ચા મળશે.', 'sadha without an hour'],
  ['સવા વાગ્યે ચા મળશે.', 'સવા વાગ્યે ચા મળશે.', 'UNSURE: sava without an hour (1:15?)'],
  ['સાડા આઠ પછી મળીએ.', 'સાડા આઠ પછી મળીએ.', 'UNSURE: sadha aath with no clock word'],
  ['સવારે આઠ લોકો આવશે.', 'સવારે આઠ લોકો આવશે.', 'savare (the morning) is not sava'],
  ['નવ લોકો આવ્યા.', 'નવ લોકો આવ્યા.', 'nine people'],
  ['સાત-આઠ વાગ્યે આવજો.', 'સાત-આઠ વાગ્યે આવજો.', 'about seven or eight'],
  ['સાત આઠ વાગ્યે આવજો.', 'સાત આઠ વાગ્યે આવજો.', 'about seven or eight, no hyphen'],
  ['સાત કે આઠ વાગ્યે આવજો.', 'સાત કે આઠ વાગ્યે આવજો.', 'seven or eight'],
  ['સાતથી આઠ વાગ્યા સુધી વર્ગ છે.', 'સાતથી આઠ વાગ્યા સુધી વર્ગ છે.', 'UNSURE: a range is left as spoken'],
  ['આઠ વાગીને પંદર થયા.', 'આઠ વાગીને પંદર થયા.', 'vagine without minit'],
  ['બેઠક બપોરે સાડા બાર વાઘે શરૂ થશે.', 'બેઠક બપોરે સાડા બાર વાઘે શરૂ થશે.', 'misheard vage (vaghe)'],
  ['બેઠક બપોરે સાળા બાર વાગે શરૂ થશે.', 'બેઠક બપોરે સાળા બાર વાગે શરૂ થશે.', 'misheard sadha (sala)'],
  ['ઘડિયાળમાં પૂર્ણ પાંચ વાગ્યા છે.', 'ઘડિયાળમાં પૂર્ણ પાંચ વાગ્યા છે.', 'misheard pona (purna)'],
  ['આજે સાંજે છ વાગ્ય બંધ થશે.', 'આજે સાંજે છ વાગ્ય બંધ થશે.', 'a cut-off vagye'],
  ['આગામી બસ સવારે 8:15 વાગ્યે આવશે.', 'આગામી બસ સવારે 8:15 વાગ્યે આવશે.', 'already digits'],
  ['अगली बस सुबह सवा आठ बजे आएगी।', 'अगली बस सुबह सवा आठ बजे आएगी।', 'Hindi is not Gujarati'],
  ['The bus leaves at a quarter past eight.', 'The bus leaves at a quarter past eight.', 'nor is English'],
  ['', '', 'nothing'],
];

const HINDI: readonly Row[] = [
  ['अगली बस सुबह सवा आठ बजे आएगी।', 'अगली बस सुबह 8:15 बजे आएगी।', 'sava: a quarter past'],
  [`बैठक दोपहर ${SAADHE} बारह बजे शुरू होगी।`, 'बैठक दोपहर 12:30 बजे शुरू होगी।', 'saadhe: half past'],
  [`बैठक दोपहर ${SAADHE_ONE} बारह बजे शुरू होगी।`, 'बैठक दोपहर 12:30 बजे शुरू होगी।', 'saadhe, U+095D'],
  [
    'घड़ी पर पौने पाँच बजे हैं और बस तैयार है।',
    'घड़ी पर 4:45 बजे हैं और बस तैयार है।',
    'paune: a quarter to',
  ],
  [
    `${GHADI_ONE} पर पौने पाँच बजे हैं।`,
    `${GHADI_ONE} पर 4:45 बजे हैं।`,
    'the words around kept as they came',
  ],
  ['आज सूचना कक्ष शाम छह बजे बंद होगा।', 'आज सूचना कक्ष शाम 6 बजे बंद होगा।', 'an hour, baje'],
  [`${DEDH} बजे भोजन होगा।`, '1:30 बजे भोजन होगा।', 'dedh: half past one'],
  [`${DEDH_ONE} बजे भोजन होगा।`, '1:30 बजे भोजन होगा।', 'dedh, U+095D'],
  ['ढाई बजे बस चलेगी।', '2:30 बजे बस चलेगी।', 'dhai: half past two'],
  ['दरवाज़ा पौने एक बजे खुलेगा।', 'दरवाज़ा 12:45 बजे खुलेगा।', 'paune ek: a quarter to one'],
  ['सभा सवा बारह बजे समाप्त होगी।', 'सभा 12:15 बजे समाप्त होगी।', 'sava barah'],
  ['पौने नौ बजे बस आएगी।', '8:45 बजे बस आएगी।', 'paune nau, first in the phrase'],
  [`बस ${SAADHE} 7 बजे आएगी।`, 'बस 7:30 बजे आएगी।', 'the hour heard as a digit'],
  ['बस सवा ८ बजे आएगी।', 'बस 8:15 बजे आएगी।', 'the hour as a Devanagari digit'],
  [
    'आज सूचना कक्ष शाम छे बजे बंद होगा।',
    'आज सूचना कक्ष शाम 6 बजे बंद होगा।',
    'chhe, as the recogniser writes six',
  ],
  ['आज शाम छः बजे सभा है।', 'आज शाम 6 बजे सभा है।', 'chhah with a visarga'],
  [
    `बैठक ${SAADHE} बारा बजे शुरू होगी।`,
    'बैठक 12:30 बजे शुरू होगी।',
    'bara, as the recogniser writes twelve',
  ],
  ['बस साढे आठ बजे आएगी।', 'बस 8:30 बजे आएगी।', 'saadhe without its nukta'],
  ['डेढ बजे भोजन होगा।', '1:30 बजे भोजन होगा।', 'dedh without its nukta'],
  ['सवारी आठ बजे आएगी।', 'सवारी 8 बजे आएगी।', 'savari is not sava'],
  // An hour and minutes.
  ['आठ बजकर पंद्रह मिनट पर बस आएगी।', '8:15 पर बस आएगी।', 'X bajkar Y minat'],
  ['अभी नौ बजकर पाँच मिनट हुए हैं।', 'अभी 9:05 हुए हैं।', 'nine past five minutes'],
  ['सात बजके पैंतालीस मिनट पर दरवाज़ा बंद होगा।', '7:45 पर दरवाज़ा बंद होगा।', 'bajke'],
  ['आठ बजकर दस मिनिट पर बस आएगी।', '8:10 पर बस आएगी।', 'minit, the other spelling'],
  ['आठ बजकर 15 मिनट पर बस आएगी।', '8:15 पर बस आएगी।', 'the minutes heard as digits'],
  // An hour and the clock word's other forms.
  ['दस बजे से ग्यारह बजे तक कक्षा है।', '10 बजे से 11 बजे तक कक्षा है।', 'from one time until another'],
  ['एक बजा है।', '1 बजा है।', 'baja'],
  ['बारह बज गए हैं।', '12 बज गए हैं।', 'baj gaye'],
  ['पांच बजने वाले हैं।', '5 बजने वाले हैं।', 'bajne; paanch with an anusvara'],
  [
    'पाँच बजने में दस मिनट बाकी हैं।',
    '5 बजने में दस मिनट बाकी हैं।',
    'the hour only: ten minutes is a length',
  ],
  [
    `सुबह सात बजे नाश्ता और ${SAADHE} नौ बजे सभा।`,
    'सुबह 7 बजे नाश्ता और 9:30 बजे सभा।',
    'two times in one phrase',
  ],
  // Negatives.
  ['कमरा नंबर बारह दूसरी मंज़िल पर है।', 'कमरा नंबर बारह दूसरी मंज़िल पर है।', 'a room number'],
  ['हरी टोकरी में चार सेब और दो केले हैं।', 'हरी टोकरी में चार सेब और दो केले हैं।', 'counts'],
  [`${SAADHE} तीन सौ कुर्सियाँ लगाइए।`, `${SAADHE} तीन सौ कुर्सियाँ लगाइए।`, '350 chairs'],
  [`इसमें ${DEDH} घंटा लगेगा।`, `इसमें ${DEDH} घंटा लगेगा।`, 'dedh with an hour: a length'],
  ['ढाई किलो चावल लाइए।', 'ढाई किलो चावल लाइए।', 'a weight'],
  ['यहाँ सवा सौ लोग हैं।', 'यहाँ सवा सौ लोग हैं।', '125 people'],
  [`${SAADHE} बजे चाय मिलेगी।`, `${SAADHE} बजे चाय मिलेगी।`, 'saadhe without an hour'],
  ['सवा बजे चाय मिलेगी।', 'सवा बजे चाय मिलेगी।', 'UNSURE: sava without an hour (1:15?)'],
  [`सुबह ${SAADHE} आठ मिलते हैं।`, `सुबह ${SAADHE} आठ मिलते हैं।`, 'UNSURE: saadhe aath with no clock word'],
  ['सात-आठ बजे आइए।', 'सात-आठ बजे आइए।', 'about seven or eight'],
  ['सात आठ बजे आइए।', 'सात आठ बजे आइए।', 'about seven or eight, no hyphen'],
  ['सात या आठ बजे आइए।', 'सात या आठ बजे आइए।', 'seven or eight'],
  [
    `सात से ${SAADHE} आठ बजे तक कक्षा है।`,
    `सात से ${SAADHE} आठ बजे तक कक्षा है।`,
    'UNSURE: a range is left as spoken',
  ],
  ['आठ बजकर पंद्रह हो गए।', 'आठ बजकर पंद्रह हो गए।', 'bajkar without minat'],
  ['बैठक दो पर साधे बारा बजे शुरू होगी।', 'बैठक दो पर साधे बारा बजे शुरू होगी।', 'misheard saadhe (sadhe)'],
  ['घड़ी पर पॉने पांच बजे हैं।', 'घड़ी पर पॉने पांच बजे हैं।', 'misheard paune'],
  ['दो घंटियाँ बजीं।', 'दो घंटियाँ बजीं।', 'bells rang'],
  ['इस साल का बजट आठ करोड़ है।', 'इस साल का बजट आठ करोड़ है।', 'a budget is not baje'],
  ['अगली बस सुबह 8:15 बजे आएगी।', 'अगली बस सुबह 8:15 बजे आएगी।', 'already digits'],
  ['આગામી બસ સવારે સવા આઠ વાગ્યે આવશે.', 'આગામી બસ સવારે સવા આઠ વાગ્યે આવશે.', 'Gujarati is not Hindi'],
  ['The meeting starts at half past twelve.', 'The meeting starts at half past twelve.', 'nor is English'],
  ['', '', 'nothing'],
];

const ENGLISH: readonly Row[] = [
  ['The bus leaves at a quarter past eight.', 'The bus leaves at 8:15.', 'a quarter past'],
  ['The meeting starts at half past twelve.', 'The meeting starts at 12:30.', 'half past'],
  ['It is a quarter to five and the bus is ready.', 'It is 4:45 and the bus is ready.', 'a quarter to'],
  ['Doors open at quarter to one.', 'Doors open at 12:45.', 'quarter to one'],
  ['The bus leaves at ten past eight.', 'The bus leaves at 8:10.', 'minutes past'],
  ['The bus leaves at twenty-five past four.', 'The bus leaves at 4:25.', 'twenty-five past'],
  ['The bus leaves at ten minutes past eight.', 'The bus leaves at 8:10.', 'ten minutes past'],
  ['Come at half past 8.', 'Come at 8:30.', 'the hour heard as a digit'],
  ['HALF PAST EIGHT', '8:30', 'capitals'],
  ["The desk closes at six o'clock today.", "The desk closes at 6 o'clock today.", "o'clock"],
  ['Twelve o’clock is lunch.', '12 o’clock is lunch.', 'o’clock with a curly apostrophe'],
  ['The bus comes at eight fifteen.', 'The bus comes at 8:15.', 'an hour and minutes, after at'],
  ['We begin at nine thirty in the morning.', 'We begin at 9:30 in the morning.', 'in the morning'],
  ['Doors open at seven forty-five.', 'Doors open at 7:45.', 'forty-five'],
  ['Doors open at seven forty five.', 'Doors open at 7:45.', 'forty five'],
  ['The class starts at ten oh five.', 'The class starts at 10:05.', 'oh five'],
  ['Lunch is at twelve thirty pm.', 'Lunch is at 12:30 pm.', 'pm'],
  ['Eight thirty a.m. is the start.', '8:30 a.m. is the start.', 'a.m. with nothing before'],
  ["It's eight fifteen.", "It's 8:15.", "it's"],
  ['We meet by eleven forty.', 'We meet by 11:40.', 'by'],
  // Negatives.
  [
    'There are four apples and two bananas in the green basket.',
    'There are four apples and two bananas in the green basket.',
    'counts',
  ],
  ['Room number twelve is on the second floor.', 'Room number twelve is on the second floor.', 'a room'],
  ['Keep three small balls inside the red box.', 'Keep three small balls inside the red box.', 'a count'],
  ['We need eight fifteen people.', 'We need eight fifteen people.', 'two numbers, no time word'],
  [
    'There are seats at eight fifteen-seat tables.',
    'There are seats at eight fifteen-seat tables.',
    'a hyphen',
  ],
  ['At eight fifteen we start.', 'At eight fifteen we start.', 'UNSURE: a word after the minutes'],
  ['Tickets are at one fifty each.', 'Tickets are at one fifty each.', 'a price'],
  ['The bus comes at eight.', 'The bus comes at eight.', 'UNSURE: an hour alone'],
  ['Meet at twenty to nine.', 'Meet at twenty to nine.', 'UNSURE: minutes to'],
  ['It takes five to ten minutes.', 'It takes five to ten minutes.', 'a range of minutes'],
  ["Come at seven or eight o'clock.", "Come at seven or eight o'clock.", 'seven or eight'],
  ["Thirteen o'clock is not a time.", "Thirteen o'clock is not a time.", 'no thirteenth hour'],
  ['A quarter of the hall is full.', 'A quarter of the hall is full.', 'a quarter of'],
  ['Half of the seats are free.', 'Half of the seats are free.', 'half of'],
  ['The bus comes at 8:15.', 'The bus comes at 8:15.', 'already digits'],
  ['આગામી બસ સવારે સવા આઠ વાગ્યે આવશે.', 'આગામી બસ સવારે સવા આઠ વાગ્યે આવશે.', 'Gujarati is not English'],
  ['', '', 'nothing'],
];

describe('normalizeSpokenTimes (QA24-CAPLANG-2e)', () => {
  describe.each([
    ['gu', GUJARATI],
    ['hi', HINDI],
    ['en', ENGLISH],
  ] as const)('%s', (lang, rows) => {
    it.each(rows)('%s -> %s (%s)', (heard, toTranslate) => {
      expect(normalizeSpokenTimes(heard, lang)).toBe(toTranslate);
    });

    it('changes nothing more when run again', () => {
      for (const [heard] of rows) {
        const once = normalizeSpokenTimes(heard, lang);
        expect(normalizeSpokenTimes(once, lang)).toBe(once);
      }
    });
  });

  it('has times to change and negatives to keep in every language', () => {
    for (const rows of [GUJARATI, HINDI, ENGLISH]) {
      expect(rows.filter(([heard, toTranslate]) => heard !== toTranslate).length).toBeGreaterThanOrEqual(15);
      expect(rows.filter(([heard, toTranslate]) => heard === toTranslate).length).toBeGreaterThanOrEqual(15);
    }
  });
});
