// A made-up calendar to try Samvat and tithi with (docs/calendar-format.md):
// placeholder names only, from today (this computer's date) for so many days.
//   node scripts/placeholder-calendar.mjs [days] > placeholder-calendar.json
// Its words mean nothing; Drashti ships no real calendar.

const days = Math.min(4000, Math.max(1, Number(process.argv[2] ?? 60) || 60));
const gujaratiDigits = (n) => String(n).replace(/\d/gu, (d) => '૦૧૨૩૪૫૬૭૮૯'[Number(d)]);
const pad = (n) => String(n).padStart(2, '0');
const at = new Date();
at.setHours(12, 0, 0, 0);
const out = [];
for (let i = 0; i < days; i++) {
  const date = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
  const tithi = (i % 15) + 1;
  const half = Math.floor(i / 15) % 2;
  out.push({
    date,
    samvat: 1001 + Math.floor(i / 360),
    month: {
      gu: `નમૂના માસ ${gujaratiDigits(1 + (Math.floor(i / 30) % 12))}`,
      en: `Placeholder month ${1 + (Math.floor(i / 30) % 12)}`,
    },
    paksha: half === 0 ? { gu: 'પહેલો પક્ષ', en: 'First half' } : { gu: 'બીજો પક્ષ', en: 'Second half' },
    tithi: { gu: `નમૂના તિથિ ${gujaratiDigits(tithi)}`, en: `Placeholder tithi ${tithi}` },
    festivals: i % 7 === 0 ? [{ gu: 'નમૂના ઉત્સવ', en: 'Placeholder festival' }] : [],
  });
  at.setDate(at.getDate() + 1);
}
process.stdout.write(
  `${JSON.stringify({ format: 'drashti-calendar', version: 1, name: 'Placeholder calendar', description: 'Made-up names for trying Drashti; not a real calendar.', days: out }, null, 2)}\n`,
);
