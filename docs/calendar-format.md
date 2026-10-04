# Samvat and tithi: the calendar file format

Drashti shows today's Vikram Samvat date, tithi and festivals: in the operator window, on stage screens, and in messages on the audience screens.

**Drashti computes no tithi, and ships no calendar.** Each mandir's admin loads a calendar file prepared from a source that BAPS or the mandir has authorised (the mandir's own panchang or calendar, as published), in the format below. Drashti shows exactly what the file gives for each date, and nothing for a date it does not give.

A made-up example is in [`examples/placeholder-calendar.json`](examples/placeholder-calendar.json) (three days in October 2026). To try it on any day, `node scripts/placeholder-calendar.mjs 60 > placeholder-calendar.json` writes one with made-up names from today for 60 days. Their words mean nothing.

## Loading a calendar

- Drag the file onto the library (the left column), or choose **Timers › Calendar › Load a calendar…**. **Import…** works too.
- The import report says what came in: how many days, from and to which date, how many festivals, and anything it left out and why.
- **Loading a calendar again updates it.** Drashti knows a calendar by its **name** (ignoring case): loading a file with the same name replaces that calendar's days. The same file loaded twice changes nothing.
- Several calendars can be loaded, one for each year, say. Where two give the same date, the one loaded last is used (the report says when that happens).
- **Calendar** (in the Timers panel) shows today's entry, lists the calendars with their dates, and removes one. Loading and removing are Pro Mode only.

## The file

A calendar is one file: UTF-8 JSON, with a name ending in `.json`. It must start by saying what it is:

```json
{
  "format": "drashti-calendar",
  "version": 1,
  "name": "Placeholder calendar",
  "description": "What it is, for the admin (optional).",
  "days": [
    {
      "date": "2026-10-04",
      "samvat": 1001,
      "month": { "gu": "નમૂના માસ ૧", "en": "Placeholder month 1" },
      "paksha": { "gu": "પહેલો પક્ષ", "en": "First half" },
      "tithi": { "gu": "નમૂના તિથિ ૧", "en": "Placeholder tithi 1" },
      "festivals": [{ "gu": "નમૂના ઉત્સવ", "en": "Placeholder festival" }]
    }
  ]
}
```

| Field         | What it is                                                                  |
| ------------- | --------------------------------------------------------------------------- |
| `format`      | Always `"drashti-calendar"`.                                                |
| `version`     | Always `1`.                                                                 |
| `name`        | The calendar's name, as the Calendar dialog lists it. Up to 120 characters. |
| `description` | Optional, for the admin.                                                    |
| `days`        | Its dates, one entry each (up to 4,000).                                    |

### A day

| Field       | What it is                                                                                           |
| ----------- | ---------------------------------------------------------------------------------------------------- |
| `date`      | The date it is for, `YYYY-MM-DD`, as the computer's clock counts days (midnight to midnight).        |
| `samvat`    | The Vikram Samvat year: a whole number.                                                              |
| `month`     | The month's name.                                                                                    |
| `paksha`    | The paksha, as it should read ("Sud", "Vad", or as the calendar writes it).                          |
| `tithi`     | The tithi, as it should read (a name or a number).                                                   |
| `festivals` | Optional: the day's festivals and observances, up to 12. Leave it out (or `[]`) for a day with none. |

Each name is given in Gujarati (`gu`), English (`en`) or both: `{ "gu": "…", "en": "…" }`. Where one is missing, the other shows in its place. Names are kept exactly as written; up to 60 characters (120 for a festival).

## How it shows

Drashti puts the names together in this order: **Samvat, the year, the month, the paksha and the tithi**, then any festivals after a dot:

- English: "Samvat 1001, Placeholder month 1 First half Placeholder tithi 1 · Placeholder festival"
- Gujarati: "સંવત ૧૦૦૧, નમૂના માસ ૧ પહેલો પક્ષ નમૂના તિથિ ૧ · નમૂના ઉત્સવ" (the year in Gujarati digits)

Where:

- **The operator window**, along the bottom (in English): today's date, tithi and festival. Simple Mode shows it too.
- **Stage screens**: a stage layout's **Samvat date and tithi** box, or a **Clock** box with **Today's Samvat date under the time**, in Gujarati or English.
- **The audience screens**: a message with a **Samvat** field ("Today: {date}", the field set to _Today's Samvat date_ in Gujarati or English), shown as any message is. The audience screens show the date only through a message, so it is up only when the operator puts it up.

Today's entry is read from the computer's clock (the one the show runs on) and changes at midnight by itself; every screen shows the same.

## What Drashti checks

- A file that does not say `"format": "drashti-calendar"`, has a field Drashti does not know, or a value of the wrong kind, is refused, and the report says where: "(at days › 3 › tithi)".
- A day that does not read (a date that does not exist, a name missing in both languages) is left out, and the report says which. A date given twice keeps the first.
- A file with no day that reads is refused.
