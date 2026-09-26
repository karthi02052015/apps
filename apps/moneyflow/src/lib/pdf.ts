/**
 * A very small PDF writer.
 *
 * The statement export needs a real PDF, and a browser-only app should not
 * carry a 500 KB PDF library to produce four pages of text and rules. So this
 * writes the file directly, using only the fourteen fonts every PDF reader is
 * required to have built in — no font embedding, no dependency, no bundle cost.
 *
 * It supports exactly what the statement needs: text, colour, horizontal rules
 * and page breaks. It is not a general-purpose PDF library and does not try to
 * be one.
 *
 * Text is encoded as WinAnsi (Latin-1), which is what the standard fonts use.
 * Characters outside it — the rupee sign, em dashes — are transliterated rather
 * than emitted as broken glyphs; `latin1` below is where that happens.
 */

export const A4 = { width: 595.28, height: 841.89 } as const;

export type FontName = 'Helvetica' | 'Helvetica-Bold' | 'Helvetica-Oblique';

const FONT_KEYS: Record<FontName, string> = {
  Helvetica: 'F1',
  'Helvetica-Bold': 'F2',
  'Helvetica-Oblique': 'F3',
};

/** Characters the standard fonts cannot show, mapped to something they can. */
const TRANSLITERATIONS: Record<string, string> = {
  '₹': 'Rs.',
  '€': 'EUR',
  '£': 'GBP',
  '—': '-',
  '–': '-',
  '−': '-',
  '’': "'",
  '‘': "'",
  '“': '"',
  '”': '"',
  '…': '...',
  '·': '-',
  '→': '->',
};

function latin1(text: string): string {
  let out = '';
  for (const character of text) {
    const replacement = TRANSLITERATIONS[character];
    if (replacement !== undefined) {
      out += replacement;
      continue;
    }
    out += character.charCodeAt(0) <= 0xff ? character : '?';
  }
  return out;
}

/** PDF string literals escape the delimiters and the escape character itself. */
function escapeText(text: string): string {
  return latin1(text).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

/**
 * Widths of the Helvetica glyphs, in thousandths of the font size.
 *
 * Only ASCII is tabulated — that is all the statement needs to measure, and a
 * full metrics table would be several kilobytes for no benefit. Anything else
 * is assumed to be an average-width glyph.
 */
const HELVETICA_WIDTHS = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

/** Width of `text` at `size`, in points. Bold runs about 3% wider. */
export function textWidth(text: string, size: number, font: FontName = 'Helvetica'): number {
  let total = 0;
  for (const character of latin1(text)) {
    const code = character.charCodeAt(0);
    total += code >= 32 && code <= 126 ? (HELVETICA_WIDTHS[code - 32] ?? 556) : 556;
  }
  const width = (total / 1000) * size;
  return font === 'Helvetica-Bold' ? width * 1.03 : width;
}

interface TextOptions {
  font?: FontName;
  size?: number;
  color?: [number, number, number];
  /** Aligns within `width`, measured from `x`. Requires `width`. */
  align?: 'left' | 'right' | 'center';
  width?: number;
}

const BLACK: [number, number, number] = [0, 0, 0];

/**
 * Builds a PDF page by page.
 *
 * `y` is measured from the *top* of the page, which is how a document is
 * naturally described; the PDF's bottom-left origin is handled internally.
 */
export class PdfBuilder {
  private pages: string[] = [];

  private current: string[] = [];

  readonly width = A4.width;

  readonly height = A4.height;

  /** Distance from the top of the page at which the next line will be drawn. */
  y = 48;

  text(value: string, x: number, y: number, options: TextOptions = {}): void {
    const { font = 'Helvetica', size = 10, color = BLACK, align = 'left', width } = options;
    let left = x;
    if (width && align !== 'left') {
      const measured = textWidth(value, size, font);
      left = align === 'right' ? x + width - measured : x + (width - measured) / 2;
    }
    this.current.push(
      `${color.join(' ')} rg`,
      'BT',
      `/${FONT_KEYS[font]} ${size} Tf`,
      `1 0 0 1 ${left.toFixed(2)} ${(this.height - y - size).toFixed(2)} Tm`,
      `(${escapeText(value)}) Tj`,
      'ET',
    );
  }

  rule(x1: number, x2: number, y: number, color: [number, number, number] = [0.88, 0.9, 0.94]): void {
    this.current.push(
      `${color.join(' ')} RG`,
      '0.75 w',
      `${x1.toFixed(2)} ${(this.height - y).toFixed(2)} m`,
      `${x2.toFixed(2)} ${(this.height - y).toFixed(2)} l`,
      'S',
    );
  }

  rect(x: number, y: number, width: number, height: number, color: [number, number, number]): void {
    this.current.push(
      `${color.join(' ')} rg`,
      `${x.toFixed(2)} ${(this.height - y - height).toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)} re`,
      'f',
    );
  }

  addPage(): void {
    this.pages.push(this.current.join('\n'));
    this.current = [];
    this.y = 48;
  }

  /** True when `needed` more points would overflow the page's bottom margin. */
  needsPage(needed = 24, bottomMargin = 64): boolean {
    return this.y + needed > this.height - bottomMargin;
  }

  pageCount(): number {
    return this.pages.length + 1;
  }

  build(): Blob {
    const contents = [...this.pages, this.current.join('\n')];
    const objects: string[] = [];
    const pageObjectIds: number[] = [];

    // Object numbering: 1 catalog, 2 page tree, 3-5 fonts, then page/content
    // pairs. The ids have to be known before the page tree is written, so the
    // layout is fixed up front rather than discovered.
    const firstPageId = 6;
    for (let i = 0; i < contents.length; i += 1) pageObjectIds.push(firstPageId + i * 2);

    objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
    objects[2] =
      `<< /Type /Pages /Count ${contents.length} ` +
      `/Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(' ')}] >>`;
    objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
    objects[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
    objects[5] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique /Encoding /WinAnsiEncoding >>';

    contents.forEach((stream, index) => {
      const pageId = pageObjectIds[index] as number;
      const contentId = pageId + 1;
      objects[pageId] =
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4.width} ${A4.height}] ` +
        `/Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >> >> ` +
        `/Contents ${contentId} 0 R >>`;
      objects[contentId] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
    });

    let file = '%PDF-1.4\n';
    const offsets: number[] = [];
    for (let id = 1; id < objects.length; id += 1) {
      const body = objects[id];
      if (body === undefined) continue;
      offsets[id] = file.length;
      file += `${id} 0 obj\n${body}\nendobj\n`;
    }

    const xrefOffset = file.length;
    const count = objects.length;
    file += `xref\n0 ${count}\n0000000000 65535 f \n`;
    for (let id = 1; id < count; id += 1) {
      const offset = offsets[id] ?? 0;
      file += `${String(offset).padStart(10, '0')} 00000 n \n`;
    }
    file += `trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

    // Latin-1, not UTF-8: every byte in the file is already in that range, and
    // encoding it as UTF-8 would shift the byte offsets the xref table records.
    const bytes = new Uint8Array(file.length);
    for (let i = 0; i < file.length; i += 1) bytes[i] = file.charCodeAt(i) & 0xff;
    return new Blob([bytes], { type: 'application/pdf' });
  }
}
