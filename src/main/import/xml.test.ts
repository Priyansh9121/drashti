import { describe, expect, it } from 'vitest';
import { arrayField, childrenOf, decodeEntities, field, parseXml, XmlError } from './xml';

describe('parseXml', () => {
  it('reads elements, attributes, text, entities and CDATA', () => {
    const doc = parseXml(
      '<?xml version="1.0" encoding="utf-8"?>\n<!-- a comment -->\n<!DOCTYPE doc [<!ENTITY x "y">]>' +
        `<doc a="1 &amp; 2" b='single'><item n="&#65;&#x42;"/><item>Tom &lt;&gt; Jerry <![CDATA[<raw & text>]]></item>\n</doc>`,
    );
    expect(doc.name).toBe('doc');
    expect(doc.attrs).toEqual({ a: '1 & 2', b: 'single' });
    const items = childrenOf(doc, 'item');
    expect(items.map((i) => i.attrs['n'] ?? i.text)).toEqual(['AB', 'Tom <> Jerry <raw & text>']);
  });

  it('finds the fields presentation files write (rvXMLIvarName)', () => {
    const slide = parseXml(
      '<RVDisplaySlide><array rvXMLIvarName="cues"/><array rvXMLIvarName="displayElements"><RVTextElement/><RVShapeElement/></array></RVDisplaySlide>',
    );
    expect(arrayField(slide, 'displayElements').map((e) => e.name)).toEqual([
      'RVTextElement',
      'RVShapeElement',
    ]);
    expect(arrayField(slide, 'cues')).toEqual([]);
    expect(field(slide, 'missing')).toBeUndefined();
    expect(arrayField(slide, 'missing')).toEqual([]);
  });

  it('refuses what is not XML, saying where', () => {
    for (const bad of [
      '',
      'just text',
      '<a><b></a>',
      '<a>',
      '<a></a><b></b>',
      '<a x=1></a>',
      '<a><!-- open</a>',
    ]) {
      expect(() => parseXml(bad)).toThrow(XmlError);
    }
  });

  it('leaves unknown entities as they are', () => {
    expect(decodeEntities('&unknown; &#xZZ; &#1114112; &amp;')).toBe('&unknown; &#xZZ; &#1114112; &');
  });
});
