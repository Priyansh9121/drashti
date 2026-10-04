# Shastra texts: the file format

Drashti shows passages from Shastra texts, such as a shlok, a vat or a Vachanamrut. They come up on the screens with their reference line ("Satsang Diksha 14") and are found by typing that reference, by searching their words, or by browsing.

**Drashti ships no texts.** Each mandir's admin loads the texts that BAPS or the mandir has authorised, prepared in the file format below. Use only an authorised source, and keep its wording exactly as it was given.

Two made-up examples to try it with are in [`examples/placeholder-granth.json`](examples/placeholder-granth.json) (items of its own) and [`examples/placeholder-vachan.json`](examples/placeholder-vachan.json) (in sections). Their words mean nothing.

## Loading a text

- Drag the file onto the library (the left column), or choose **Shastra › Texts… › Load a text…**. **Import…** works too.
- The import report says what came in: how many items and sections, what Drashti made (see "Languages"), and anything it left out and why.
- **Loading a text again updates it.** Drashti knows a text by its **abbreviation**: the same abbreviation (ignoring case, dots and spaces) means the same text. Items keep their place by section and number, so playlists that name a passage keep working. Items no longer in the file go. The same file loaded twice changes nothing.
- **Texts…** also chooses each text's theme (how its passages look) and removes a text. Both are Pro Mode only. A removed text's passages show as missing in playlists until it is loaded again.

## The file

A text is one file: UTF-8 JSON, with a name ending in `.json`. It must start by saying what it is:

```json
{
  "format": "drashti-shastra",
  "version": 1,
  "name": "Placeholder Granth",
  "abbreviation": "PG",
  "description": "What it is, for the admin (optional).",
  "items": [
    {
      "number": 1,
      "title": "Optional",
      "text": {
        "sa": "नमूना श्लोकः…",
        "gu": "નમૂના અર્થ…",
        "en": "The placeholder meaning…"
      }
    }
  ]
}
```

| Field          | What it is                                                                                                                            |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `format`       | Always `"drashti-shastra"`.                                                                                                           |
| `version`      | Always `1`.                                                                                                                           |
| `name`         | The text's name as the screens show it in the reference line: "Placeholder Granth 14".                                                |
| `abbreviation` | What the operator types: "PG 14". Up to 24 characters. Dots, spaces and case don't matter when typing, so "G.Pr." can be typed "gpr". |
| `description`  | Optional, for the admin.                                                                                                              |
| `items`        | The text's numbered items, when it has no sections.                                                                                   |
| `sections`     | Or its sections, each with its own items or sections (see below). A text has one or the other.                                        |

### Items

| Field    | What it is                                                                                                                     |
| -------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `number` | Its number in its section (or the text): a whole number, unique there. References use it: "PG 14", "PG 14-16".                 |
| `title`  | Optional: shown when browsing.                                                                                                 |
| `text`   | Its words, in one or more languages (see below). Line breaks (`\n`) are kept: a shlok's lines stay lines. An item needs words. |

### Sections

A text arranged in parts, such as a Vachanamrut's (Gadhada Pratham, Sarangpur…), has `sections` instead of `items`. Sections can hold sections, nested as deep as the text needs:

```json
"sections": [
  {
    "label": "Placeholder Pratham",
    "abbreviation": "P.Pr.",
    "items": [{ "number": 1, "text": { "gu": "…", "en": "…" } }]
  }
]
```

| Field          | What it is                                                                                      |
| -------------- | ----------------------------------------------------------------------------------------------- |
| `label`        | The section's name, as the reference line shows it: "Placeholder Vachan Placeholder Pratham 1". |
| `abbreviation` | Optional: what the operator types for it, "PV P.Pr. 1". Without one, the label is typed.        |
| `items`        | Its items, or                                                                                   |
| `sections`     | its own sections. Not both.                                                                     |

A section is known by its abbreviation (or its label), so keep these the same when updating a text.

## Languages

`text` gives an item's words in any of these:

| Key        | Language                                                                              |
| ---------- | ------------------------------------------------------------------------------------- |
| `sa`       | Sanskrit, in Devanagari **or** Gujarati script: Drashti reads which from the letters. |
| `sa-gu`    | Sanskrit in Gujarati script (the same as `sa` written in Gujarati letters).           |
| `gu`       | Gujarati                                                                              |
| `hi`       | Hindi                                                                                 |
| `en`       | English                                                                               |
| `translit` | Roman transliteration                                                                 |

**Sanskrit has two languages in Drashti**, one for each script, so each screen group's Look can show the script its people read. For example, the hall shows the shlok in Gujarati script with its Gujarati meaning, the Hindi side in Devanagari with the Hindi meaning, and the stream shows the transliteration with the English meaning. The two scripts map letter for letter, so when a file gives Sanskrit in one script, Drashti writes it in the other too, **marked as made by Drashti**.

**Transliteration** a file leaves out is made by Drashti from the Sanskrit (keeping every "a", as Sanskrit is said: "dharmakṣetre", not "dharmkṣetr"), or else from the Gujarati or Hindi, with the same rules as kirtans and in the style chosen for them (plain, or with accent marks). It is marked as made, too. A transliteration in the file is always used as it is.

Each screen group shows the languages its Look chooses, in its order. The reference line shows on every screen.

## Finding a passage

- **By reference**, in the Shastra tab, the phone remote or the API: the text's abbreviation (or its name), then the sections' abbreviations, then a number or a range:
  - `PG 14`, `pg14`, `Placeholder Granth 14`
  - `PG 14-16` (a range, within one section)
  - `PV P.Pr. 1`, `pv ppr 1`, `PV Placeholder Pratham 1`

  A reference that names nothing is refused, saying why: "No loaded text is called “XY”. The texts are: PG, PV." or "Placeholder Granth has no 99: it goes from 1 to 21." A passage shows up to 60 items at a time.

- **By its words**, in any language, accents ignored ("sloka" finds "śloka"): every word typed must start one of the item's words.
- **By browsing** a text, its sections and items.

## How a passage looks

- It becomes slides, drawn with its text's **theme**: a style per language, the **reference line's style** (above or below the words), and the box (set in Themes; chosen for each text in **Texts…**). A theme's background colour is the slides' colour; a picture or video goes on the background layer, as a presentation's does.
- Each item starts a slide. A long item goes on over several, cut at its line breaks, else at the ends of sentences (. ? ! । ॥), into parts that fit the box. Every language is cut alike, so a slide holds the same part of the item in each, and the reference line counts the parts: "Placeholder Granth 21 (2/4)".
- The cutting fits where the live Look shows the passage: each group's languages, and a lower third (fewer lines) where a group, or the stream's Camera layout on air, shows one.
- **Next** and **Back** step through its slides, then on to the next playlist item. A passage can be a playlist item, and a template slot can ask for one ("A Shastra passage").

## What Drashti checks

- A file that does not say `"format": "drashti-shastra"`, has a field Drashti does not know, or a value of the wrong kind, is refused, and the report says where: "(at items › 3 › number)".
- A file with no items with words is refused.
- An item given twice with the same number keeps the first; an item with no words, or a section given twice, is left out. The report lists each.
- Sizes: up to 20,000 items in a section, 40,000 characters of words per language per item.
