import { describe, expect, it } from 'vitest';
import { capitalize, hasIndic, transliterate } from './translit';

/*
 * Common single words, never lines from kirtans. Each row: the word in
 * Gujarati and in Devanagari (null where the two languages use another
 * word, or the letter is one script's own), then Plain and With accent
 * marks (ISO 15919). A row with a script of its own gives that script's
 * reading only.
 */

interface Row {
  gu?: string;
  hi?: string;
  plain: string;
  iso: string;
  note?: string;
}

const WORDS: Row[] = [
  // The "a" at the end of a word is not said; in a word of one letter it is.
  { gu: 'ઘર', hi: 'घर', plain: 'ghar', iso: 'ghar' },
  { gu: 'રામ', hi: 'राम', plain: 'ram', iso: 'rām' },
  { gu: 'દેવ', hi: 'देव', plain: 'dev', iso: 'dēv' },
  { gu: 'મન', hi: 'मन', plain: 'man', iso: 'man' },
  { gu: 'દસ', hi: 'दस', plain: 'das', iso: 'das' },
  { gu: 'એક', hi: 'एक', plain: 'ek', iso: 'ēk' },
  { gu: 'આજ', hi: 'आज', plain: 'aj', iso: 'āj' },
  { gu: 'ન', hi: 'न', plain: 'na', iso: 'na', note: 'one letter keeps its a' },
  { gu: 'રાત', hi: 'रात', plain: 'rat', iso: 'rāt' },
  { gu: 'સુખ', hi: 'सुख', plain: 'sukh', iso: 'sukh' },
  { gu: 'ભજન', hi: 'भजन', plain: 'bhajan', iso: 'bhajan' },
  { gu: 'અમર', hi: 'अमर', plain: 'amar', iso: 'amar' },
  { gu: 'વચન', hi: 'वचन', plain: 'vachan', iso: 'vacan' },
  { gu: 'સમય', hi: 'समय', plain: 'samay', iso: 'samay' },
  { gu: 'ભારત', hi: 'भारत', plain: 'bharat', iso: 'bhārat' },
  { gu: 'જીવન', hi: 'जीवन', plain: 'jivan', iso: 'jīvan' },
  { gu: 'પ્રેમ', hi: 'प्रेम', plain: 'prem', iso: 'prēm' },
  { gu: 'શરીર', hi: 'शरीर', plain: 'sharir', iso: 'śarīr' },
  { gu: 'સાગર', hi: 'सागर', plain: 'sagar', iso: 'sāgar' },
  { gu: 'દિવસ', hi: 'दिवस', plain: 'divas', iso: 'divas' },
  { gu: 'ઉત્તર', hi: 'उत्तर', plain: 'uttar', iso: 'uttar' },
  { gu: 'પર્વત', hi: 'पर्वत', plain: 'parvat', iso: 'parvat' },
  { gu: 'પુસ્તક', hi: 'पुस्तक', plain: 'pustak', iso: 'pustak' },
  { gu: 'અક્ષર', hi: 'अक्षर', plain: 'akshar', iso: 'akṣar' },
  { gu: 'ભોજન', hi: 'भोजन', plain: 'bhojan', iso: 'bhōjan' },
  { gu: 'ઉત્સવ', hi: 'उत्सव', plain: 'utsav', iso: 'utsav' },
  { gu: 'આકાશ', hi: 'आकाश', plain: 'akash', iso: 'ākāś' },
  { gu: 'શિક્ષક', hi: 'शिक्षक', plain: 'shikshak', iso: 'śikṣak' },
  // Vowel signs.
  { gu: 'ગુરુ', hi: 'गुरु', plain: 'guru', iso: 'guru' },
  { gu: 'માતા', hi: 'माता', plain: 'mata', iso: 'mātā' },
  { gu: 'પિતા', hi: 'पिता', plain: 'pita', iso: 'pitā' },
  { gu: 'ભાઈ', hi: 'भाई', plain: 'bhai', iso: 'bhāī' },
  { gu: 'નદી', hi: 'नदी', plain: 'nadi', iso: 'nadī' },
  { gu: 'ફૂલ', hi: 'फूल', plain: 'phul', iso: 'phūl' },
  { gu: 'સાધુ', hi: 'साधु', plain: 'sadhu', iso: 'sādhu' },
  { gu: 'કથા', hi: 'कथा', plain: 'katha', iso: 'kathā' },
  { gu: 'સભા', hi: 'सभा', plain: 'sabha', iso: 'sabhā' },
  { gu: 'ચાર', hi: 'चार', plain: 'char', iso: 'cār' },
  { gu: 'પાન', hi: 'पान', plain: 'pan', iso: 'pān' },
  { gu: 'ભાષા', hi: 'भाषा', plain: 'bhasha', iso: 'bhāṣā' },
  { gu: 'સ્તુતિ', hi: 'स्तुति', plain: 'stuti', iso: 'stuti' },
  { gu: 'ધૂન', hi: 'धून', plain: 'dhun', iso: 'dhūn' },
  { gu: 'શ્લોક', hi: 'श्लोक', plain: 'shlok', iso: 'ślōk' },
  { gu: 'રસોઈ', hi: 'रसोई', plain: 'rasoi', iso: 'rasōī' },
  { gu: 'ઔષધ', hi: 'औषध', plain: 'aushadh', iso: 'auṣadh' },
  { gu: 'ઐક્ય', hi: 'ऐक्य', plain: 'aikya', iso: 'aikya' },
  // The "a" in the middle where it is not said.
  { gu: 'આરતી', hi: 'आरती', plain: 'arti', iso: 'ārtī' },
  { gu: 'ભગવાન', hi: 'भगवान', plain: 'bhagwan', iso: 'bhagvān' },
  { gu: 'ધરતી', hi: 'धरती', plain: 'dharti', iso: 'dhartī' },
  { gu: 'અમદાવાદ', plain: 'amdavad', iso: 'amdāvād' },
  { gu: 'કરવું', plain: 'karvun', iso: 'karvuṁ' },
  { gu: 'બોલવું', plain: 'bolvun', iso: 'bōlvuṁ' },
  { hi: 'करना', plain: 'karna', iso: 'karnā' },
  { hi: 'समझना', plain: 'samajhna', iso: 'samajhnā' },
  { hi: 'अपना', plain: 'apna', iso: 'apnā' },
  { hi: 'बचपन', plain: 'bachpan', iso: 'bacpan' },
  { hi: 'कमरा', plain: 'kamra', iso: 'kamrā' },
  { hi: 'आदमी', plain: 'admi', iso: 'ādmī' },
  { hi: 'रहना', plain: 'rahna', iso: 'rahnā' },
  // Clusters: virama, and an "a" kept after y, r, l, v or a nasal at the end.
  { gu: 'ભક્તિ', hi: 'भक्ति', plain: 'bhakti', iso: 'bhakti' },
  { gu: 'દર્શન', hi: 'दर्शन', plain: 'darshan', iso: 'darśan' },
  { gu: 'પ્રાર્થના', hi: 'प्रार्थना', plain: 'prarthana', iso: 'prārthanā' },
  { gu: 'સત્ય', hi: 'सत्य', plain: 'satya', iso: 'satya' },
  { gu: 'મિત્ર', hi: 'मित्र', plain: 'mitra', iso: 'mitra' },
  { gu: 'ધર્મ', hi: 'धर्म', plain: 'dharma', iso: 'dharma' },
  { gu: 'કર્મ', hi: 'कर्म', plain: 'karma', iso: 'karma' },
  { gu: 'સૂર્ય', hi: 'सूर्य', plain: 'surya', iso: 'sūrya' },
  { gu: 'ચંદ્ર', hi: 'चंद्र', plain: 'chandra', iso: 'caṁdra' },
  { gu: 'પૂર્વ', hi: 'पूर्व', plain: 'purva', iso: 'pūrva' },
  { gu: 'રત્ન', hi: 'रत्न', plain: 'ratna', iso: 'ratna' },
  { gu: 'અર્થ', hi: 'अर्थ', plain: 'arth', iso: 'arth' },
  { gu: 'શબ્દ', hi: 'शब्द', plain: 'shabd', iso: 'śabd' },
  { gu: 'શુદ્ધ', hi: 'शुद्ध', plain: 'shuddh', iso: 'śuddh' },
  { gu: 'માર્ગ', hi: 'मार्ग', plain: 'marg', iso: 'mārg' },
  { gu: 'અષ્ટક', hi: 'अष्टक', plain: 'ashtak', iso: 'aṣṭak' },
  { gu: 'વિદ્યાર્થી', hi: 'विद्यार्थी', plain: 'vidyarthi', iso: 'vidyārthī' },
  { gu: 'પશ્ચિમ', hi: 'पश्चिम', plain: 'pashchim', iso: 'paścim' },
  { gu: 'શ્રદ્ધા', hi: 'श्रद्धा', plain: 'shraddha', iso: 'śraddhā' },
  { gu: 'ક્ષમા', hi: 'क्षमा', plain: 'kshama', iso: 'kṣamā' },
  { gu: 'દક્ષિણ', hi: 'दक्षिण', plain: 'dakshin', iso: 'dakṣiṇ' },
  { gu: 'નમસ્તે', hi: 'नमस्ते', plain: 'namaste', iso: 'namastē' },
  { gu: 'હિન્દી', hi: 'हिन्दी', plain: 'hindi', iso: 'hindī' },
  { hi: 'जगत्', plain: 'jagat', iso: 'jagat', note: 'a virama at the end' },
  { hi: 'विद्वान्', plain: 'vidwan', iso: 'vidvān' },
  // v after a consonant, said w (plain), but not after r or l.
  { gu: 'સ્વામી', hi: 'स्वामी', plain: 'swami', iso: 'svāmī' },
  { gu: 'સ્વાગત', hi: 'स्वागत', plain: 'swagat', iso: 'svāgat' },
  { gu: 'દ્વાર', hi: 'द्वार', plain: 'dwar', iso: 'dvār' },
  { gu: 'વિશ્વ', hi: 'विश्व', plain: 'vishwa', iso: 'viśva' },
  // Anusvara: n, or m before p, ph, b, bh and m.
  { gu: 'મંદિર', hi: 'मंदिर', plain: 'mandir', iso: 'maṁdir' },
  { gu: 'સંત', hi: 'संत', plain: 'sant', iso: 'saṁt' },
  { gu: 'ગંગા', hi: 'गंगा', plain: 'ganga', iso: 'gaṁgā' },
  { gu: 'શાંતિ', hi: 'शांति', plain: 'shanti', iso: 'śāṁti' },
  { gu: 'હંસ', hi: 'हंस', plain: 'hans', iso: 'haṁs' },
  { gu: 'સુંદર', hi: 'सुंदर', plain: 'sundar', iso: 'suṁdar' },
  { gu: 'સંબંધ', hi: 'संबंध', plain: 'sambandh', iso: 'saṁbaṁdh' },
  { gu: 'હંમેશા', plain: 'hammesha', iso: 'haṁmēśā' },
  { gu: 'પાંચ', plain: 'panch', iso: 'pāṁc' },
  // Chandrabindu.
  { hi: 'पाँच', plain: 'panch', iso: 'pām̐c' },
  { hi: 'चाँद', plain: 'chand', iso: 'cām̐d' },
  { hi: 'आँख', plain: 'ankh', iso: 'ām̐kh' },
  { hi: 'हँसना', plain: 'hansna', iso: 'ham̐snā' },
  // Visarga: h at the end, not said before a consonant (plain).
  { gu: 'દુઃખ', hi: 'दुःख', plain: 'dukh', iso: 'duḥkh' },
  { gu: 'નમઃ', hi: 'नमः', plain: 'namah', iso: 'namaḥ' },
  { gu: 'અતઃ', hi: 'अतः', plain: 'atah', iso: 'ataḥ' },
  { gu: 'પુનઃ', hi: 'पुनः', plain: 'punah', iso: 'punaḥ' },
  // Nukta.
  { hi: 'ज़मीन', plain: 'zamin', iso: 'zamīn' },
  { hi: 'फ़ायदा', plain: 'fayda', iso: 'fāydā' },
  { hi: 'लड़का', plain: 'ladka', iso: 'laṛkā' },
  { hi: 'पढ़ना', plain: 'padhna', iso: 'paṛhnā' },
  { hi: 'क़लम', plain: 'kalam', iso: 'qalam' },
  { hi: 'ख़ुशी', plain: 'khushi', iso: 'k͟huśī' },
  { hi: 'ग़ज़ल', plain: 'gazal', iso: 'ġazal' },
  { hi: 'हज़ार', plain: 'hazar', iso: 'hazār' },
  // Where the two languages say it differently: ઋ "ru", ऋ "ri"; જ્ઞ "gn", ज्ञ "gy".
  { gu: 'ઋષિ', plain: 'rushi', iso: 'r̥ṣi' },
  { hi: 'ऋषि', plain: 'rishi', iso: 'r̥ṣi' },
  { gu: 'કૃષ્ણ', plain: 'krushna', iso: 'kr̥ṣṇa' },
  { hi: 'कृष्ण', plain: 'krishna', iso: 'kr̥ṣṇa' },
  { gu: 'હૃદય', plain: 'hruday', iso: 'hr̥day' },
  { hi: 'हृदय', plain: 'hriday', iso: 'hr̥day' },
  { gu: 'વૃક્ષ', plain: 'vruksh', iso: 'vr̥kṣ' },
  { hi: 'वृक्ष', plain: 'vriksh', iso: 'vr̥kṣ' },
  { gu: 'જ્ઞાન', plain: 'gnan', iso: 'jñān' },
  { hi: 'ज्ञान', plain: 'gyan', iso: 'jñān' },
  // Different words for the same thing.
  { gu: 'પાણી', plain: 'pani', iso: 'pāṇī' },
  { hi: 'पानी', plain: 'pani', iso: 'pānī' },
  { gu: 'બહેન', plain: 'bahen', iso: 'bahēn' },
  { hi: 'बहन', plain: 'bahan', iso: 'bahan' },
  { gu: 'બે', plain: 'be', iso: 'bē' },
  { hi: 'दो', plain: 'do', iso: 'dō' },
  { hi: 'सौ', plain: 'sau', iso: 'sau' },
  // The letters only Gujarati has: ળ, and ઍ and ઑ (with their signs ૅ and ૉ).
  { gu: 'કમળ', plain: 'kamal', iso: 'kamaḷ' },
  { hi: 'कमल', plain: 'kamal', iso: 'kamal' },
  { gu: 'ફળ', plain: 'phal', iso: 'phaḷ' },
  { gu: 'થાળ', plain: 'thal', iso: 'thāḷ' },
  { gu: 'પીળો', plain: 'pilo', iso: 'pīḷō' },
  { gu: 'કેળું', plain: 'kelun', iso: 'kēḷuṁ' },
  { gu: 'ઑફિસ', plain: 'ophis', iso: 'ôphis' },
  { gu: 'બૅંક', plain: 'bank', iso: 'bêṁk' },
  { gu: 'ઍસિડ', plain: 'asid', iso: 'êsiḍ' },
  { hi: 'डॉक्टर', plain: 'doktar', iso: 'ḍôkṭar' },
  // Om, and the numerals.
  { gu: 'ૐ', hi: 'ॐ', plain: 'om', iso: 'ōṁ' },
  { gu: '૧૯૮૪', hi: '१९८४', plain: '1984', iso: '1984' },
];

const entries = WORDS.flatMap((row) => [
  ...(row.gu ? [{ script: 'Gujarati', word: row.gu, row }] : []),
  ...(row.hi ? [{ script: 'Devanagari', word: row.hi, row }] : []),
]);

describe('transliterating common words', () => {
  it('has a hundred words or more, in both scripts', () => {
    expect(WORDS.length).toBeGreaterThanOrEqual(100);
    expect(entries.filter((e) => e.script === 'Gujarati').length).toBeGreaterThanOrEqual(80);
    expect(entries.filter((e) => e.script === 'Devanagari').length).toBeGreaterThanOrEqual(80);
  });

  it.each(entries.map((e) => [e.script, e.word, e.row.plain, e.row.iso] as const))(
    '%s %s → %s, %s',
    (_script, word, plain, iso) => {
      expect(transliterate(word, 'plain')).toBe(plain);
      expect(transliterate(word, 'iso')).toBe(iso);
    },
  );
});

describe('transliterating text', () => {
  it('keeps spaces, punctuation and other letters, and turns dandas and numerals', () => {
    expect(transliterate('રામ, ભજન! (Placeholder) ૧૨ ।', 'plain')).toBe('ram, bhajan! (Placeholder) 12 |');
    expect(transliterate('घर ॥ १', 'iso')).toBe('ghar || 1');
  });

  it('writes a and a short i or u said apart with a diaeresis, with marks only', () => {
    expect(transliterate('કઇ', 'iso')).toBe('kaï');
    expect(transliterate('कउ', 'iso')).toBe('kaü');
    expect(transliterate('કઇ', 'plain')).toBe('kai');
    // A long ī is never read as part of ai.
    expect(transliterate('કઈ', 'iso')).toBe('kaī');
  });

  it('starts a line with a capital letter', () => {
    expect(capitalize('ghar ane mandir')).toBe('Ghar ane mandir');
    expect(capitalize('— ārtī')).toBe('— Ārtī');
    expect(capitalize('12')).toBe('12');
  });

  it('knows which text it can transliterate', () => {
    expect(hasIndic('Placeholder')).toBe(false);
    expect(hasIndic('ઘર')).toBe(true);
    expect(hasIndic('घर')).toBe(true);
  });
});

/*
 * Kinds of word the rules still get wrong (kept here so a change that fixes
 * or breaks them is noticed): compounds and Sanskrit names, where an "a"
 * in the middle is said but the rule drops it; names spelt with the "a"
 * people no longer say; nasal vowels in plain letters, which read as an n.
 */
describe('what the rules still get wrong', () => {
  it.each([
    ['સહજાનંદ', 'sahjanand', 'a compound: said "sahajanand"'],
    ['ઉપનિષદ', 'upnishad', 'a Sanskrit word: said "upanishad"'],
    ['ગુજરાત', 'gujrat', 'a name usually spelt "Gujarat"'],
    ['गाँव', 'ganv', 'a nasal vowel: said "gaon"'],
    ['फ़िल्म', 'filma', 'a loanword ending in a cluster: said "film"'],
  ])('%s → %s (%s)', (word, wrong) => {
    expect(transliterate(word, 'plain')).toBe(wrong);
  });
});
