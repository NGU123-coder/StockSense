import JsBarcode from 'jsbarcode';
import { Printer } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { inr } from '../lib/format';

/** Renders a scannable EAN-13 / Code 128 label and prints it on a shelf-label sized page. */
export function BarcodeLabel({ code, name, sku, price }: { code: string; name: string; sku: string; price: number }) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!svgRef.current) return;
    const format = /^\d{13}$/.test(code) ? 'EAN13' : 'CODE128';
    try {
      JsBarcode(svgRef.current, code, { format, height: 54, width: 1.7, fontSize: 13, margin: 0, background: 'transparent' });
    } catch {
      JsBarcode(svgRef.current, code, { format: 'CODE128', height: 54, width: 1.5, fontSize: 13, margin: 0 });
    }
  }, [code]);

  const print = () => {
    const svg = svgRef.current?.outerHTML ?? '';
    const w = window.open('', '_blank', 'width=420,height=320');
    if (!w) return;
    w.document.write(`<!doctype html><title>${sku}</title>
      <style>@page{size:62mm 40mm;margin:3mm}body{font-family:Arial,sans-serif;margin:0;text-align:center}
      .n{font-size:11px;font-weight:700;margin-bottom:2px}.p{font-size:13px;font-weight:700;margin-top:2px}svg{max-width:100%}</style>
      <div class="n">${name.replace(/</g, '&lt;')}</div>${svg}<div class="p">MRP ${inr(price, { compact: false })}</div>
      <script>window.onload=()=>{window.print();setTimeout(()=>window.close(),300)}</script>`);
    w.document.close();
  };

  return (
    <div className="flex flex-col items-start gap-3">
      <div className="rounded-[var(--radius-md)] border border-dashed border-line-strong bg-white px-5 py-4">
        <svg ref={svgRef} aria-label={`Barcode ${code}`} />
      </div>
      <button className="btn-ghost" onClick={print}>
        <Printer size={15} /> Print shelf label
      </button>
    </div>
  );
}
