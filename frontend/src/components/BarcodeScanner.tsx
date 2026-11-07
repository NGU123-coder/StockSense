import { CameraOff } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Modal } from './ui';

/**
 * Camera barcode scanner (EAN-13, Code 128, QR…) using ZXing in the browser.
 * The library is loaded only when the scanner opens, keeping the main bundle small.
 * A typed-in code works too, for laptops without a camera or USB barcode guns.
 */
export function BarcodeScanner({
  open,
  onClose,
  onDetected,
}: {
  open: boolean;
  onClose: () => void;
  onDetected: (code: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState('');

  useEffect(() => {
    if (!open) return;
    let stop: (() => void) | undefined;
    let cancelled = false;
    setError(null);

    (async () => {
      try {
        const { BrowserMultiFormatReader } = await import('@zxing/browser');
        if (cancelled || !videoRef.current) return;
        const reader = new BrowserMultiFormatReader();
        const controls = await reader.decodeFromConstraints(
          { video: { facingMode: 'environment' } },
          videoRef.current,
          (result) => {
            if (result) {
              controls.stop();
              navigator.vibrate?.(60);
              onDetected(result.getText());
            }
          },
        );
        stop = () => controls.stop();
        if (cancelled) stop();
      } catch (e) {
        const name = (e as Error).name;
        setError(
          name === 'NotAllowedError'
            ? 'Camera access was blocked. Allow it in your browser settings, or type the code below.'
            : 'No camera found on this device. Type or paste the barcode below.',
        );
      }
    })();

    return () => {
      cancelled = true;
      stop?.();
    };
  }, [open, onDetected]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (manual.trim()) {
      onDetected(manual.trim());
      setManual('');
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Scan a barcode">
      <div className="relative aspect-[4/3] overflow-hidden rounded-[var(--radius-md)] bg-ink">
        {error ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center text-white/80">
            <CameraOff size={28} />
            <p className="text-[13px]">{error}</p>
          </div>
        ) : (
          <>
            <video ref={videoRef} className="h-full w-full object-cover" muted playsInline />
            {/* Aiming guide */}
            <div className="pointer-events-none absolute inset-x-[12%] top-1/2 h-[28%] -translate-y-1/2 rounded-md border-2 border-signal/90 shadow-[0_0_0_9999px_rgba(20,33,61,.35)]" />
          </>
        )}
      </div>
      <p className="mt-3 text-[12px] text-muted">Hold the barcode inside the frame. It is read automatically.</p>
      <form onSubmit={submit} className="mt-4 flex gap-2">
        <input
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          className="input"
          placeholder="Or type a barcode or SKU, e.g. 8901234100011"
          aria-label="Barcode or SKU"
          inputMode="text"
        />
        <button className="btn-primary" type="submit">
          Find
        </button>
      </form>
    </Modal>
  );
}
