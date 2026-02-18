import { jsPDF } from 'jspdf';
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, BorderStyle, IRunOptions } from 'docx';

interface ExportPRD {
  title: string;
  description?: string;
  content: string;
}

interface TextSegment {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
}

function parseInlineFormatting(text: string): TextSegment[] {
  const segments: TextSegment[] = [];
  // Match **bold**, *italic*, `code` — process left to right
  const pattern = /(\*\*(.+?)\*\*|\*(.+?)\*|`([^`]+)`)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    // Text before the match
    if (match.index > lastIndex) {
      segments.push({ text: text.slice(lastIndex, match.index) });
    }

    if (match[2]) {
      // **bold**
      segments.push({ text: match[2], bold: true });
    } else if (match[3]) {
      // *italic*
      segments.push({ text: match[3], italic: true });
    } else if (match[4]) {
      // `code`
      segments.push({ text: match[4], code: true });
    }

    lastIndex = match.index + match[0].length;
  }

  // Remaining text
  if (lastIndex < text.length) {
    segments.push({ text: text.slice(lastIndex) });
  }

  if (segments.length === 0) {
    segments.push({ text });
  }

  return segments;
}

function renderFormattedLine(
  pdf: jsPDF,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  baseFontSize: number = 11
): number {
  const segments = parseInlineFormatting(text);
  let xPos = x;
  let yOffset = 0;
  const lineHeight = baseFontSize * 0.55;

  for (const seg of segments) {
    if (seg.code) {
      pdf.setFont('courier', 'normal');
      pdf.setFontSize(baseFontSize - 1);
    } else if (seg.bold) {
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(baseFontSize);
    } else if (seg.italic) {
      pdf.setFont('helvetica', 'italic');
      pdf.setFontSize(baseFontSize);
    } else {
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(baseFontSize);
    }

    const textWidth = pdf.getTextWidth(seg.text);
    if (xPos + textWidth > x + maxWidth && xPos > x) {
      // Wrap to next line
      xPos = x;
      yOffset += lineHeight;
    }

    const wrappedLines = pdf.splitTextToSize(seg.text, maxWidth - (xPos - x));
    for (let i = 0; i < wrappedLines.length; i++) {
      if (i > 0) {
        xPos = x;
        yOffset += lineHeight;
      }
      pdf.text(wrappedLines[i], xPos, y + yOffset);
      xPos += pdf.getTextWidth(wrappedLines[i]);
    }
  }

  // Reset font
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(baseFontSize);

  return yOffset + lineHeight;
}

function checkPageBreak(pdf: jsPDF, yPosition: number, neededSpace: number = 20): number {
  if (yPosition > pdf.internal.pageSize.getHeight() - neededSpace) {
    pdf.addPage();
    return 20;
  }
  return yPosition;
}

export async function generatePDF(prd: ExportPRD): Promise<Buffer> {
  const pdf = new jsPDF();
  const pageWidth = pdf.internal.pageSize.getWidth();
  const margin = 20;
  const maxWidth = pageWidth - (margin * 2);
  let yPosition = 20;

  // Title
  pdf.setFontSize(22);
  pdf.setFont('helvetica', 'bold');
  const titleLines = pdf.splitTextToSize(prd.title, maxWidth);
  pdf.text(titleLines, margin, yPosition);
  yPosition += titleLines.length * 10 + 10;

  // Description
  if (prd.description) {
    pdf.setFontSize(12);
    pdf.setFont('helvetica', 'italic');
    const descLines = pdf.splitTextToSize(prd.description, maxWidth);
    pdf.text(descLines, margin, yPosition);
    yPosition += descLines.length * 7 + 15;
  }

  // Separator
  pdf.setLineWidth(0.5);
  pdf.line(margin, yPosition, pageWidth - margin, yPosition);
  yPosition += 10;

  // Content - Parse markdown-style content
  pdf.setFontSize(11);
  pdf.setFont('helvetica', 'normal');

  const contentLines = prd.content.split('\n');
  let inCodeBlock = false;

  for (const line of contentLines) {
    yPosition = checkPageBreak(pdf, yPosition);

    // Code block toggle
    if (line.trim().startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      if (inCodeBlock) {
        yPosition += 2;
      } else {
        yPosition += 4;
      }
      continue;
    }

    // Inside code block
    if (inCodeBlock) {
      yPosition = checkPageBreak(pdf, yPosition);
      // Light gray background
      pdf.setFillColor(245, 245, 245);
      pdf.rect(margin, yPosition - 4, maxWidth, 6, 'F');
      pdf.setFont('courier', 'normal');
      pdf.setFontSize(9);
      const codeLines = pdf.splitTextToSize(line, maxWidth - 4);
      pdf.text(codeLines, margin + 2, yPosition);
      yPosition += codeLines.length * 5;
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(11);
      continue;
    }

    if (line.startsWith('# ')) {
      // H1 - Main heading — ensure enough space
      yPosition = checkPageBreak(pdf, yPosition, 30);
      pdf.setFontSize(18);
      pdf.setFont('helvetica', 'bold');
      const text = line.substring(2);
      const lines = pdf.splitTextToSize(text, maxWidth);
      pdf.text(lines, margin, yPosition);
      yPosition += lines.length * 8 + 8;
      pdf.setFontSize(11);
      pdf.setFont('helvetica', 'normal');
    } else if (line.startsWith('## ')) {
      // H2 - Section heading — ensure enough space
      yPosition = checkPageBreak(pdf, yPosition, 25);
      pdf.setFontSize(14);
      pdf.setFont('helvetica', 'bold');
      const text = line.substring(3);
      const lines = pdf.splitTextToSize(text, maxWidth);
      pdf.text(lines, margin, yPosition);
      yPosition += lines.length * 7 + 6;
      pdf.setFontSize(11);
      pdf.setFont('helvetica', 'normal');
    } else if (line.startsWith('### ')) {
      // H3 - Subsection
      yPosition = checkPageBreak(pdf, yPosition, 20);
      pdf.setFontSize(12);
      pdf.setFont('helvetica', 'bold');
      const text = line.substring(4);
      const lines = pdf.splitTextToSize(text, maxWidth);
      pdf.text(lines, margin, yPosition);
      yPosition += lines.length * 6 + 5;
      pdf.setFontSize(11);
      pdf.setFont('helvetica', 'normal');
    } else if (line.startsWith('- ') || line.startsWith('* ')) {
      // Bullet point with inline formatting
      const text = line.substring(2);
      pdf.text('•', margin + 2, yPosition);
      const height = renderFormattedLine(pdf, text, margin + 8, yPosition, maxWidth - 8);
      yPosition += height;
    } else if (/^\d+\.\s/.test(line)) {
      // Numbered list
      const numMatch = line.match(/^(\d+)\.\s(.*)$/);
      if (numMatch) {
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(11);
        pdf.text(`${numMatch[1]}.`, margin + 2, yPosition);
        const height = renderFormattedLine(pdf, numMatch[2], margin + 12, yPosition, maxWidth - 12);
        yPosition += height;
      }
    } else if (/^(---|___|\*\*\*)$/.test(line.trim())) {
      // Horizontal rule
      yPosition += 2;
      pdf.setLineWidth(0.3);
      pdf.setDrawColor(180, 180, 180);
      pdf.line(margin, yPosition, pageWidth - margin, yPosition);
      pdf.setDrawColor(0, 0, 0);
      yPosition += 6;
    } else if (line.trim() === '') {
      // Empty line
      yPosition += 4;
    } else {
      // Regular text with inline formatting
      const height = renderFormattedLine(pdf, line, margin, yPosition, maxWidth);
      yPosition += height;
    }
  }

  // Convert to buffer
  const pdfBuffer = Buffer.from(pdf.output('arraybuffer'));
  return pdfBuffer;
}

function parseInlineFormattingToTextRuns(text: string, baseOptions: Partial<IRunOptions> = {}): TextRun[] {
  const segments = parseInlineFormatting(text);
  return segments.map(seg => {
    const options: Partial<IRunOptions> & { text: string } = {
      ...baseOptions,
      text: seg.text,
    };
    if (seg.bold) options.bold = true;
    if (seg.italic) options.italics = true;
    if (seg.code) {
      options.font = 'Courier New';
      options.size = 20; // 10pt in half-points
      options.shading = { type: 'clear' as any, color: 'auto', fill: 'F5F5F5' };
    }
    return new TextRun(options);
  });
}

export async function generateWord(prd: ExportPRD): Promise<Buffer> {
  const children: Paragraph[] = [];

  // Title
  children.push(
    new Paragraph({
      text: prd.title,
      heading: HeadingLevel.TITLE,
      spacing: { after: 200 },
    })
  );

  // Description
  if (prd.description) {
    children.push(
      new Paragraph({
        children: [
          new TextRun({
            text: prd.description,
            italics: true,
          }),
        ],
        spacing: { after: 400 },
      })
    );
  }

  // Content - Parse markdown-style content
  const contentLines = prd.content.split('\n');
  let inCodeBlock = false;

  for (const line of contentLines) {
    // Code block toggle
    if (line.trim().startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      continue;
    }

    // Inside code block
    if (inCodeBlock) {
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: line,
              font: 'Courier New',
              size: 20,
            }),
          ],
          spacing: { after: 40 },
          shading: { type: 'clear' as any, color: 'auto', fill: 'F5F5F5' },
        })
      );
      continue;
    }

    if (line.startsWith('# ')) {
      children.push(
        new Paragraph({
          children: parseInlineFormattingToTextRuns(line.substring(2)),
          heading: HeadingLevel.HEADING_1,
          spacing: { before: 240, after: 120 },
        })
      );
    } else if (line.startsWith('## ')) {
      children.push(
        new Paragraph({
          children: parseInlineFormattingToTextRuns(line.substring(3)),
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 200, after: 100 },
        })
      );
    } else if (line.startsWith('### ')) {
      children.push(
        new Paragraph({
          children: parseInlineFormattingToTextRuns(line.substring(4)),
          heading: HeadingLevel.HEADING_3,
          spacing: { before: 160, after: 80 },
        })
      );
    } else if (line.startsWith('- ') || line.startsWith('* ')) {
      children.push(
        new Paragraph({
          children: parseInlineFormattingToTextRuns(line.substring(2)),
          bullet: { level: 0 },
          spacing: { after: 100 },
        })
      );
    } else if (/^\d+\.\s/.test(line)) {
      // Numbered list item
      const text = line.replace(/^\d+\.\s/, '');
      children.push(
        new Paragraph({
          children: parseInlineFormattingToTextRuns(text),
          numbering: { reference: 'default-numbering', level: 0 },
          spacing: { after: 100 },
        })
      );
    } else if (/^(---|___|\*\*\*)$/.test(line.trim())) {
      // Horizontal rule
      children.push(
        new Paragraph({
          text: '',
          border: {
            bottom: { style: BorderStyle.SINGLE, size: 6, color: 'B4B4B4' },
          },
          spacing: { before: 120, after: 120 },
        })
      );
    } else if (line.trim() === '') {
      children.push(
        new Paragraph({
          text: '',
          spacing: { after: 120 },
        })
      );
    } else {
      // Regular text with inline formatting
      children.push(
        new Paragraph({
          children: parseInlineFormattingToTextRuns(line),
          spacing: { after: 100 },
        })
      );
    }
  }

  const doc = new Document({
    numbering: {
      config: [
        {
          reference: 'default-numbering',
          levels: [
            {
              level: 0,
              format: 'decimal' as any,
              text: '%1.',
              alignment: AlignmentType.START,
            },
          ],
        },
      ],
    },
    sections: [
      {
        properties: {},
        children,
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  return buffer;
}
