import PDFDocument from 'pdfkit';

export interface PoPdfData {
  poNumber: string;
  status: string;
  createdAt: Date;
  expectedDate: Date | null;
  notes: string | null;
  totalAmount: number;
  supplier: {
    name: string;
    contactName: string | null;
    email: string | null;
    phone: string | null;
    city: string | null;
  };
  warehouse: { name: string; code: string; city: string; address: string | null };
  createdBy: string | null;
  approvedBy: string | null;
  items: { sku: string; name: string; unit: string; quantity: number; unitCost: number }[];
}

// Built-in PDF fonts have no ₹ glyph, so amounts use "Rs." in the PDF.
const inr = (n: number) => `Rs. ${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const date = (d: Date | null) =>
  d ? d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

/** Renders a purchase order as a printable A4 PDF and returns it as a Buffer. */
export function renderPoPdf(po: PoPdfData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const ink = '#0f172a';
    const muted = '#64748b';
    const accent = '#0f766e';
    const left = 48;
    const right = doc.page.width - 48;

    // Header
    doc.fillColor(accent).font('Helvetica-Bold').fontSize(20).text('StockSense', left, 48);
    doc.fillColor(muted).font('Helvetica').fontSize(9).text('Inventory & demand planning', left, 72);
    doc.fillColor(ink).font('Helvetica-Bold').fontSize(16).text('PURCHASE ORDER', left, 48, { align: 'right' });
    doc.font('Helvetica').fontSize(10).fillColor(muted).text(po.poNumber, left, 70, { align: 'right' });
    doc.text(`Status: ${po.status}`, { align: 'right' });

    doc.moveTo(left, 104).lineTo(right, 104).strokeColor('#e2e8f0').stroke();

    // Parties
    const col2 = left + 260;
    doc.fillColor(muted).fontSize(8).font('Helvetica-Bold').text('SUPPLIER', left, 120).text('DELIVER TO', col2, 120);
    doc.fillColor(ink).fontSize(11).font('Helvetica-Bold').text(po.supplier.name, left, 134, { width: 240 });
    doc.font('Helvetica').fontSize(9).fillColor(muted);
    [po.supplier.contactName, po.supplier.email, po.supplier.phone, po.supplier.city]
      .filter(Boolean)
      .forEach((l) => doc.text(l as string, { width: 240 }));
    doc
      .fillColor(ink)
      .fontSize(11)
      .font('Helvetica-Bold')
      .text(`${po.warehouse.name} (${po.warehouse.code})`, col2, 134, { width: 240 });
    doc.font('Helvetica').fontSize(9).fillColor(muted);
    [po.warehouse.address, po.warehouse.city]
      .filter(Boolean)
      .forEach((l) => doc.text(l as string, col2, undefined, { width: 240 }));

    // Meta row
    const metaY = 210;
    const meta = [
      ['Order date', date(po.createdAt)],
      ['Expected delivery', date(po.expectedDate)],
      ['Raised by', po.createdBy ?? '—'],
      ['Approved by', po.approvedBy ?? '—'],
    ];
    meta.forEach(([k, v], i) => {
      const x = left + i * 125;
      doc.fillColor(muted).fontSize(8).font('Helvetica-Bold').text(k.toUpperCase(), x, metaY);
      doc
        .fillColor(ink)
        .fontSize(10)
        .font('Helvetica')
        .text(v, x, metaY + 12, { width: 120 });
    });

    // Items table
    let y = 260;
    const cols = { sku: left, name: left + 80, qty: left + 300, cost: left + 360, amt: left + 440 };
    doc.rect(left, y - 6, right - left, 22).fill('#f1f5f9');
    doc.fillColor(muted).font('Helvetica-Bold').fontSize(8);
    doc
      .text('SKU', cols.sku + 6, y)
      .text('ITEM', cols.name, y)
      .text('QTY', cols.qty, y, { width: 50, align: 'right' });
    doc
      .text('UNIT COST', cols.cost, y, { width: 70, align: 'right' })
      .text('AMOUNT', cols.amt, y, { width: right - cols.amt - 6, align: 'right' });
    y += 24;

    doc.font('Helvetica').fontSize(9).fillColor(ink);
    for (const item of po.items) {
      if (y > doc.page.height - 120) {
        doc.addPage();
        y = 60;
      }
      doc.text(item.sku, cols.sku + 6, y, { width: 72 });
      doc.text(item.name, cols.name, y, { width: 210 });
      doc.text(`${item.quantity} ${item.unit}`, cols.qty - 10, y, { width: 60, align: 'right' });
      doc.text(inr(item.unitCost), cols.cost, y, { width: 70, align: 'right' });
      doc.text(inr(item.quantity * item.unitCost), cols.amt, y, { width: right - cols.amt - 6, align: 'right' });
      y += 20;
      doc
        .moveTo(left, y - 6)
        .lineTo(right, y - 6)
        .strokeColor('#f1f5f9')
        .stroke();
    }

    y += 6;
    doc
      .font('Helvetica-Bold')
      .fontSize(11)
      .fillColor(ink)
      .text('Total', cols.cost - 40, y, { width: 110, align: 'right' });
    doc.text(inr(po.totalAmount), cols.amt, y, { width: right - cols.amt - 6, align: 'right' });

    if (po.notes) {
      y += 36;
      doc.fillColor(muted).fontSize(8).font('Helvetica-Bold').text('NOTES', left, y);
      doc
        .fillColor(ink)
        .fontSize(9)
        .font('Helvetica')
        .text(po.notes, left, y + 12, { width: right - left });
    }

    doc
      .fillColor(muted)
      .fontSize(8)
      .text(
        'Generated by StockSense. Please quote the PO number on your invoice and delivery challan.',
        left,
        doc.page.height - 70,
        {
          width: right - left,
          align: 'center',
        },
      );
    doc.end();
  });
}
