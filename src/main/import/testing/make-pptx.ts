import { makeZip } from './zip-writer';

/*
 * A small PowerPoint file made for tests (Session 15): coloured slides with
 * a line of placeholder words, speaker notes, a hidden slide and an
 * animation where asked, and the parts PowerPoint and Keynote expect (a
 * theme, a master and a layout, a notes master).
 */

export interface TestPptxSlide {
  color: string;
  text: string;
  notes?: string;
  hidden?: boolean;
  /** The words come in with a fade (an entrance animation). */
  animated?: boolean;
}

const NS =
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const escape = (text: string) => text.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;');

const rels = (list: { id: string; type: string; target: string }[]) =>
  `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${list
    .map((r) => `<Relationship Id="${r.id}" Type="${REL}/${r.type}" Target="${r.target}"/>`)
    .join('')}</Relationships>`;

const GROUP = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>';
const CLR_MAP =
  'bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"';

const THEME = `${XML}<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Placeholder"><a:themeElements><a:clrScheme name="Placeholder"><a:dk1><a:srgbClr val="000000"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="1F2937"/></a:dk2><a:lt2><a:srgbClr val="F3F4F6"/></a:lt2><a:accent1><a:srgbClr val="3E63DD"/></a:accent1><a:accent2><a:srgbClr val="E5484D"/></a:accent2><a:accent3><a:srgbClr val="30A46C"/></a:accent3><a:accent4><a:srgbClr val="F5D90A"/></a:accent4><a:accent5><a:srgbClr val="8E4EC6"/></a:accent5><a:accent6><a:srgbClr val="F76808"/></a:accent6><a:hlink><a:srgbClr val="0091FF"/></a:hlink><a:folHlink><a:srgbClr val="8E4EC6"/></a:folHlink></a:clrScheme><a:fontScheme name="Placeholder"><a:majorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="Placeholder"><a:fillStyleLst>${'<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'.repeat(3)}</a:fillStyleLst><a:lnStyleLst>${['6350', '12700', '19050'].map((w) => `<a:ln w="${w}"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>`).join('')}</a:lnStyleLst><a:effectStyleLst>${'<a:effectStyle><a:effectLst/></a:effectStyle>'.repeat(3)}</a:effectStyleLst><a:bgFillStyleLst>${'<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'.repeat(3)}</a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`;

const MASTER = `${XML}<p:sldMaster ${NS}><p:cSld><p:spTree>${GROUP}</p:spTree></p:cSld><p:clrMap ${CLR_MAP}/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle><a:lvl1pPr><a:defRPr sz="4400"/></a:lvl1pPr></p:titleStyle><p:bodyStyle><a:lvl1pPr><a:defRPr sz="2800"/></a:lvl1pPr></p:bodyStyle><p:otherStyle><a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr></p:otherStyle></p:txStyles></p:sldMaster>`;
const LAYOUT = `${XML}<p:sldLayout ${NS} type="blank" preserve="1"><p:cSld name="Blank"><p:spTree>${GROUP}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;
const NOTES_MASTER = `${XML}<p:notesMaster ${NS}><p:cSld><p:spTree>${GROUP}</p:spTree></p:cSld><p:clrMap ${CLR_MAP}/></p:notesMaster>`;

/** A fade in for shape 2, as PowerPoint writes an entrance animation. */
const FADE_IN =
  '<p:timing><p:tnLst><p:par><p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot"><p:childTnLst><p:seq concurrent="1" nextAc="seek"><p:cTn id="2" dur="indefinite" nodeType="mainSeq"><p:childTnLst><p:par><p:cTn id="3" fill="hold"><p:stCondLst><p:cond delay="indefinite"/></p:stCondLst><p:childTnLst><p:par><p:cTn id="4" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst><p:par><p:cTn id="5" presetID="10" presetClass="entr" presetSubtype="0" fill="hold" grpId="0" nodeType="clickEffect"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst><p:set><p:cBhvr><p:cTn id="6" dur="1" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst></p:cTn><p:tgtEl><p:spTgt spid="2"/></p:tgtEl><p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst></p:cBhvr><p:to><p:strVal val="visible"/></p:to></p:set><p:animEffect transition="in" filter="fade"><p:cBhvr><p:cTn id="7" dur="500"/><p:tgtEl><p:spTgt spid="2"/></p:tgtEl></p:cBhvr></p:animEffect></p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn><p:prevCondLst><p:cond evt="onPrev" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:prevCondLst><p:nextCondLst><p:cond evt="onNext" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:nextCondLst></p:seq></p:childTnLst></p:cTn></p:par></p:tnLst><p:bldLst><p:bldP spid="2" grpId="0"/></p:bldLst></p:timing>';

const paragraphs = (text: string) =>
  text
    .split('\n')
    .map((line) => `<a:p><a:r><a:rPr lang="en-US" dirty="0"/><a:t>${escape(line)}</a:t></a:r></a:p>`)
    .join('');

function slideXml(slide: TestPptxSlide): string {
  return `${XML}<p:sld ${NS}${slide.hidden ? ' show="0"' : ''}><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="${slide.color}"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree>${GROUP}<p:sp><p:nvSpPr><p:cNvPr id="2" name="Placeholder words"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="914400" y="2743200"/><a:ext cx="10363200" cy="1371600"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" sz="4000" dirty="0"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:rPr><a:t>${escape(slide.text)}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>${slide.animated ? FADE_IN : ''}</p:sld>`;
}

function notesXml(notes: string): string {
  return `${XML}<p:notes ${NS}><p:cSld><p:spTree>${GROUP}<p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide number"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldNum" sz="quarter" idx="5"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US"/><a:t>7</a:t></a:r></a:p></p:txBody></p:sp><p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/>${paragraphs(notes)}</p:txBody></p:sp></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>`;
}

export function makeTestPptx(slides: readonly TestPptxSlide[]): Buffer {
  const n = slides.map((_, i) => i + 1);
  const files: { name: string; data: string }[] = [
    {
      name: '[Content_Types].xml',
      data: `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/notesMasters/notesMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesMaster+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/><Override PartName="/ppt/theme/theme2.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>${n
        .map(
          (i) =>
            `<Override PartName="/ppt/slides/slide${String(i)}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/><Override PartName="/ppt/notesSlides/notesSlide${String(i)}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"/>`,
        )
        .join('')}</Types>`,
    },
    {
      name: '_rels/.rels',
      data: rels([{ id: 'rId1', type: 'officeDocument', target: 'ppt/presentation.xml' }]),
    },
    {
      name: 'ppt/presentation.xml',
      data: `${XML}<p:presentation ${NS}><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:notesMasterIdLst><p:notesMasterId r:id="rId2"/></p:notesMasterIdLst><p:sldIdLst>${n.map((i) => `<p:sldId id="${String(255 + i)}" r:id="rId${String(9 + i)}"/>`).join('')}</p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`,
    },
    {
      name: 'ppt/_rels/presentation.xml.rels',
      data: rels([
        { id: 'rId1', type: 'slideMaster', target: 'slideMasters/slideMaster1.xml' },
        { id: 'rId2', type: 'notesMaster', target: 'notesMasters/notesMaster1.xml' },
        { id: 'rId3', type: 'theme', target: 'theme/theme1.xml' },
        ...n.map((i) => ({
          id: `rId${String(9 + i)}`,
          type: 'slide',
          target: `slides/slide${String(i)}.xml`,
        })),
      ]),
    },
    { name: 'ppt/theme/theme1.xml', data: THEME },
    { name: 'ppt/theme/theme2.xml', data: THEME },
    { name: 'ppt/slideMasters/slideMaster1.xml', data: MASTER },
    {
      name: 'ppt/slideMasters/_rels/slideMaster1.xml.rels',
      data: rels([
        { id: 'rId1', type: 'slideLayout', target: '../slideLayouts/slideLayout1.xml' },
        { id: 'rId2', type: 'theme', target: '../theme/theme1.xml' },
      ]),
    },
    { name: 'ppt/slideLayouts/slideLayout1.xml', data: LAYOUT },
    {
      name: 'ppt/slideLayouts/_rels/slideLayout1.xml.rels',
      data: rels([{ id: 'rId1', type: 'slideMaster', target: '../slideMasters/slideMaster1.xml' }]),
    },
    { name: 'ppt/notesMasters/notesMaster1.xml', data: NOTES_MASTER },
    {
      name: 'ppt/notesMasters/_rels/notesMaster1.xml.rels',
      data: rels([{ id: 'rId1', type: 'theme', target: '../theme/theme2.xml' }]),
    },
  ];
  slides.forEach((slide, k) => {
    const i = String(k + 1);
    files.push(
      { name: `ppt/slides/slide${i}.xml`, data: slideXml(slide) },
      {
        name: `ppt/slides/_rels/slide${i}.xml.rels`,
        data: rels([
          { id: 'rId1', type: 'slideLayout', target: '../slideLayouts/slideLayout1.xml' },
          { id: 'rId2', type: 'notesSlide', target: `../notesSlides/notesSlide${i}.xml` },
        ]),
      },
      { name: `ppt/notesSlides/notesSlide${i}.xml`, data: notesXml(slide.notes ?? '') },
      {
        name: `ppt/notesSlides/_rels/notesSlide${i}.xml.rels`,
        data: rels([
          { id: 'rId1', type: 'notesMaster', target: '../notesMasters/notesMaster1.xml' },
          { id: 'rId2', type: 'slide', target: `../slides/slide${i}.xml` },
        ]),
      },
    );
  });
  return makeZip(files.map((f) => ({ name: f.name, data: f.data, deflate: true })));
}
