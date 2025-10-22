import { jsPDF } from 'jspdf';
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } from 'docx';

interface ExportPRD {
  title: string;
  description?: string;
  content: string;
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
  
  for (const line of contentLines) {
    // Check if we need a new page
    if (yPosition > pdf.internal.pageSize.getHeight() - 20) {
      pdf.addPage();
      yPosition = 20;
    }

    if (line.startsWith('# ')) {
      // H1 - Main heading
      pdf.setFontSize(18);
      pdf.setFont('helvetica', 'bold');
      const text = line.substring(2);
      const lines = pdf.splitTextToSize(text, maxWidth);
      pdf.text(lines, margin, yPosition);
      yPosition += lines.length * 8 + 8;
      pdf.setFontSize(11);
      pdf.setFont('helvetica', 'normal');
    } else if (line.startsWith('## ')) {
      // H2 - Section heading
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
      pdf.setFontSize(12);
      pdf.setFont('helvetica', 'bold');
      const text = line.substring(4);
      const lines = pdf.splitTextToSize(text, maxWidth);
      pdf.text(lines, margin, yPosition);
      yPosition += lines.length * 6 + 5;
      pdf.setFontSize(11);
      pdf.setFont('helvetica', 'normal');
    } else if (line.startsWith('- ') || line.startsWith('* ')) {
      // Bullet point
      const text = '• ' + line.substring(2);
      const lines = pdf.splitTextToSize(text, maxWidth - 5);
      pdf.text(lines, margin + 5, yPosition);
      yPosition += lines.length * 6;
    } else if (line.trim() === '') {
      // Empty line
      yPosition += 4;
    } else {
      // Regular text
      const lines = pdf.splitTextToSize(line, maxWidth);
      pdf.text(lines, margin, yPosition);
      yPosition += lines.length * 6;
    }
  }

  // Convert to buffer
  const pdfBuffer = Buffer.from(pdf.output('arraybuffer'));
  return pdfBuffer;
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
  
  for (const line of contentLines) {
    if (line.startsWith('# ')) {
      // H1 - Main heading
      children.push(
        new Paragraph({
          text: line.substring(2),
          heading: HeadingLevel.HEADING_1,
          spacing: { before: 240, after: 120 },
        })
      );
    } else if (line.startsWith('## ')) {
      // H2 - Section heading
      children.push(
        new Paragraph({
          text: line.substring(3),
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 200, after: 100 },
        })
      );
    } else if (line.startsWith('### ')) {
      // H3 - Subsection
      children.push(
        new Paragraph({
          text: line.substring(4),
          heading: HeadingLevel.HEADING_3,
          spacing: { before: 160, after: 80 },
        })
      );
    } else if (line.startsWith('- ') || line.startsWith('* ')) {
      // Bullet point
      children.push(
        new Paragraph({
          text: line.substring(2),
          bullet: {
            level: 0,
          },
          spacing: { after: 100 },
        })
      );
    } else if (line.trim() === '') {
      // Empty line
      children.push(
        new Paragraph({
          text: '',
          spacing: { after: 120 },
        })
      );
    } else if (line.trim() !== '---') {
      // Regular text (skip horizontal rules)
      children.push(
        new Paragraph({
          text: line,
          spacing: { after: 100 },
        })
      );
    }
  }

  const doc = new Document({
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
