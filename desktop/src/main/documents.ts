import { BrowserWindow } from 'electron'
import { copyFileSync, readFileSync, writeFileSync } from 'fs'
import { basename, extname, join } from 'path'
import mammoth from 'mammoth'
import { extractText, getDocumentProxy } from 'unpdf'
import { AlignmentType, Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx'
import { marked } from 'marked'
import { cvOriginalsDir } from './paths'

// ---------- Import: .docx / .pdf / .txt / .md -> Markdown ----------

function htmlToMarkdown(html: string): string {
  return html
    .replace(/<h1[^>]*>(.*?)<\/h1>/gi, '\n# $1\n')
    .replace(/<h2[^>]*>(.*?)<\/h2>/gi, '\n## $1\n')
    .replace(/<h[3-6][^>]*>(.*?)<\/h[3-6]>/gi, '\n### $1\n')
    .replace(/<li[^>]*>(.*?)<\/li>/gi, '- $1\n')
    .replace(/<\/?(ul|ol)[^>]*>/gi, '\n')
    .replace(/<(strong|b)>(.*?)<\/(strong|b)>/gi, '**$2**')
    .replace(/<(em|i)>(.*?)<\/(em|i)>/gi, '*$2*')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<p[^>]*>(.*?)<\/p>/gi, '$1\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export async function importCvFile(file: string): Promise<{ text: string; storedCopy: string; name: string }> {
  const ext = extname(file).toLowerCase()
  const buf = readFileSync(file)
  let text: string
  if (ext === '.docx') {
    const { value } = await mammoth.convertToHtml({ buffer: buf })
    text = htmlToMarkdown(value)
  } else if (ext === '.pdf') {
    const pdf = await getDocumentProxy(new Uint8Array(buf))
    const { text: raw } = await extractText(pdf, { mergePages: true })
    text = raw.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  } else if (ext === '.txt' || ext === '.md') {
    text = buf.toString('utf8')
  } else {
    throw new Error('Use a .docx, .pdf, .txt or .md file.')
  }
  if (!text.trim()) throw new Error('That file had no readable text (a scanned PDF needs OCR first).')
  const storedCopy = join(cvOriginalsDir(), `${Date.now()}-${basename(file)}`)
  copyFileSync(file, storedCopy)
  return { text, storedCopy, name: basename(file, ext) }
}

// ---------- Export: Markdown -> .docx ----------

function runs(line: string, size = 21): TextRun[] {
  const parts = line.split(/(\*\*[^*]+\*\*)/g).filter(Boolean)
  return parts.map((p) =>
    p.startsWith('**') && p.endsWith('**')
      ? new TextRun({ text: p.slice(2, -2), bold: true, size, font: 'Calibri' })
      : new TextRun({ text: p.replace(/\*([^*]+)\*/g, '$1'), size, font: 'Calibri' })
  )
}

export async function markdownToDocx(markdown: string, outFile: string): Promise<string> {
  const paragraphs: Paragraph[] = []
  for (const raw of markdown.split('\n')) {
    const line = raw.trimEnd()
    if (!line.trim()) { paragraphs.push(new Paragraph({ spacing: { after: 60 } })); continue }
    if (line.startsWith('# ')) {
      paragraphs.push(new Paragraph({ heading: HeadingLevel.TITLE, alignment: AlignmentType.LEFT, children: runs(line.slice(2), 36) }))
    } else if (line.startsWith('## ')) {
      paragraphs.push(new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 200, after: 80 }, children: runs(line.slice(3), 26) }))
    } else if (line.startsWith('### ')) {
      paragraphs.push(new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 120, after: 40 }, children: runs(line.slice(4), 22) }))
    } else if (/^\s*[-*•]\s+/.test(line)) {
      paragraphs.push(new Paragraph({ bullet: { level: 0 }, spacing: { after: 40 }, children: runs(line.replace(/^\s*[-*•]\s+/, '')) }))
    } else {
      paragraphs.push(new Paragraph({ spacing: { after: 60 }, children: runs(line) }))
    }
  }
  const doc = new Document({
    styles: { default: { document: { run: { font: 'Calibri', size: 21 } } } },
    sections: [{ properties: { page: { margin: { top: 900, bottom: 900, left: 1000, right: 1000 } } }, children: paragraphs }]
  })
  writeFileSync(outFile, await Packer.toBuffer(doc))
  return outFile
}

// ---------- Export: Markdown -> PDF (Chromium print) ----------

const PRINT_CSS = `
  @page { size: A4; margin: 16mm 16mm; }
  body { font-family: Calibri, 'Segoe UI', Arial, sans-serif; font-size: 10.5pt; line-height: 1.4; color: #111827; }
  h1 { font-size: 22pt; margin: 0 0 4pt; letter-spacing: -0.01em; }
  h2 { font-size: 12pt; text-transform: uppercase; letter-spacing: 0.06em; color: #1f3a8a;
       border-bottom: 1px solid #c7d2fe; padding-bottom: 2pt; margin: 14pt 0 6pt; }
  h3 { font-size: 11pt; margin: 10pt 0 2pt; }
  ul { margin: 2pt 0 6pt 16pt; padding: 0; } li { margin: 1.5pt 0; }
  p { margin: 3pt 0; }
`

export async function markdownToPdf(markdown: string, outFile: string): Promise<string> {
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>${PRINT_CSS}</style></head><body>${await marked.parse(markdown)}</body></html>`
  const win = new BrowserWindow({ show: false, webPreferences: { javascript: false } })
  try {
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    const pdf = await win.webContents.printToPDF({ pageSize: 'A4', printBackground: true, preferCSSPageSize: true })
    writeFileSync(outFile, pdf)
    return outFile
  } finally {
    win.destroy()
  }
}
