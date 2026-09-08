import JSZip from 'jszip';

/**
 * Builds a minimal but structurally real .pptx in memory.
 *
 * PowerPoint stores a deck as a zip of XML parts: slide text in
 * ppt/slides/slideN.xml, and speaker notes in ppt/notesSlides/notesSlideM.xml —
 * where M is emphatically NOT N. Notes parts are numbered in creation order, so
 * the moment some slides have no notes the two sequences diverge. The mapping
 * lives in each slide's _rels file.
 *
 * This fixture reproduces that divergence deliberately, because assuming
 * notesSlideN belongs to slideN is the obvious implementation and it is wrong.
 */

const NS =
    'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
    'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';

const REL_NS = 'xmlns="http://schemas.openxmlformats.org/package/2006/relationships"';

function paragraphs(lines: string[]): string {
    return lines
        .map(line => `<a:p><a:r><a:rPr lang="en-US"/><a:t>${line}</a:t></a:r></a:p>`)
        .join('');
}

function slideXml(lines: string[]): string {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld ${NS}><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/></p:nvSpPr>
<p:txBody><a:bodyPr/>${paragraphs(lines)}</p:txBody></p:sp></p:spTree></p:cSld></p:sld>`;
}

/** Real notes slides carry a slide-number placeholder alongside the notes. */
function notesXml(shownNumber: number, lines: string[]): string {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:notes ${NS}><p:cSld><p:spTree>
<p:sp><p:nvSpPr><p:cNvPr id="3" name="Slide Number Placeholder"/></p:nvSpPr>
<p:txBody><a:bodyPr/><a:p><a:fld id="{X}" type="slidenum"><a:t>${shownNumber}</a:t></a:fld></a:p></p:txBody></p:sp>
<p:sp><p:nvSpPr><p:cNvPr id="2" name="Notes Placeholder"/></p:nvSpPr>
<p:txBody><a:bodyPr/>${paragraphs(lines)}</p:txBody></p:sp>
</p:spTree></p:cSld></p:notes>`;
}

/** The relationship that actually ties a slide to its notes part. */
function slideRels(notesTarget?: string): string {
    const notesRel = notesTarget
        ? `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/${notesTarget}"/>`
        : '';
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships ${REL_NS}><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>${notesRel}</Relationships>`;
}

/** A slide whose only content is a table — text lives in a:tc / a:tr cells. */
function tableSlideXml(): string {
    const cell = (t: string) =>
        `<a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:t>${t}</a:t></a:r></a:p></a:txBody></a:tc>`;
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld ${NS}><p:cSld><p:spTree><p:graphicFrame><a:graphic><a:graphicData><a:tbl>
<a:tr>${cell('Model')}${cell('Cost per session')}</a:tr>
<a:tr>${cell('gpt-4o-mini')}${cell('$0.03')}</a:tr>
</a:tbl></a:graphicData></a:graphic></p:graphicFrame></p:spTree></p:cSld></p:sld>`;
}

/** SmartArt: the slide holds only a reference; the text is in ppt/diagrams. */
function diagramXml(): string {
    return `<?xml version="1.0"?><dgm:dataModel ${NS}><dgm:ptLst>
<dgm:pt><dgm:t><a:p><a:r><a:t>Ingest</a:t></a:r></a:p></dgm:t></dgm:pt>
<dgm:pt><dgm:t><a:p><a:r><a:t>Ground</a:t></a:r></a:p></dgm:t></dgm:pt>
<dgm:pt><dgm:t><a:p><a:r><a:t>Answer</a:t></a:r></a:p></dgm:t></dgm:pt>
</dgm:ptLst></dgm:dataModel>`;
}

/** Charts keep labels in a:t and values in c:v, in a separate part. */
function chartXml(): string {
    return `<?xml version="1.0"?><c:chartSpace><c:title><c:tx><c:rich>
<a:p><a:r><a:t>Answer latency</a:t></a:r></a:p></c:rich></c:tx></c:title>
<c:ser><c:cat><c:strRef><c:strCache>
<c:pt><c:v>Cold start</c:v></c:pt><c:pt><c:v>Warm</c:v></c:pt>
</c:strCache></c:strRef></c:cat>
<c:val><c:numRef><c:numCache><c:pt><c:v>52</c:v></c:pt><c:pt><c:v>1.4</c:v></c:pt>
</c:numCache></c:numRef></c:val></c:ser></c:chartSpace>`;
}

export async function buildFixturePptx(): Promise<Uint8Array> {
    const zip = new JSZip();
    zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types/>');

    zip.file('ppt/slides/slide1.xml', slideXml([
        'MyAvatar: an AI digital twin',
        'Fan Kaiwei',
    ]));
    zip.file('ppt/slides/slide2.xml', slideXml([
        'Architecture',
        'React &amp; TypeScript frontend',
        'Express backend, streamed responses',
    ]));
    // Deliberately out of lexical order: slide10 must not sort before slide2.
    zip.file('ppt/slides/slide10.xml', slideXml(['Questions?']));

    // The divergence that matters: slide 1 has NO notes, so the deck's first
    // notes part is notesSlide1 and it belongs to slide 2. Naive number
    // matching would attach it to slide 1 and find nothing for slide 2.
    zip.file('ppt/slides/_rels/slide1.xml.rels', slideRels());
    zip.file('ppt/slides/_rels/slide2.xml.rels', slideRels('notesSlide1.xml'));
    zip.file('ppt/slides/_rels/slide10.xml.rels', slideRels('notesSlide2.xml'));

    zip.file('ppt/notesSlides/notesSlide1.xml', notesXml(2, [
        'The interesting part is grounding: it refuses rather than inventing.',
    ]));
    zip.file('ppt/notesSlides/notesSlide2.xml', notesXml(3, [
        'Invite questions. The avatar answers, I stay quiet unless it stalls.',
    ]));

    // Slides whose content is NOT in the slide XML. Most decks have no notes,
    // so these are where the answers have to come from.
    zip.file('ppt/slides/slide3.xml', tableSlideXml());
    zip.file('ppt/slides/_rels/slide3.xml.rels', slideRels());

    zip.file('ppt/slides/slide4.xml', slideXml(['How it works']));
    zip.file(
        'ppt/slides/_rels/slide4.xml.rels',
        `<?xml version="1.0"?><Relationships ${REL_NS}>` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/diagramData" Target="../diagrams/data1.xml"/>` +
        `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart1.xml"/>` +
        `</Relationships>`,
    );
    zip.file('ppt/diagrams/data1.xml', diagramXml());
    zip.file('ppt/charts/chart1.xml', chartXml());

    return zip.generateAsync({ type: 'uint8array' });
}
