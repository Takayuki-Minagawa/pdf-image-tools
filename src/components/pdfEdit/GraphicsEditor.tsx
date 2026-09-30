import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { ArrowDownToLine, ArrowUpToLine, Copy, ImagePlus, MousePointer2, PenLine, Trash2 } from 'lucide-react';
import { createDefaultGraphic } from '../../types/pdfGraphics';
import type { PdfGraphic } from '../../types/pdfGraphics';

interface GraphicsEditorProps {
  graphics: PdfGraphic[];
  onChange: (graphics: PdfGraphic[]) => void;
  activeGraphicId: string | null;
  onActiveChange: (id: string | null) => void;
  currentPageIndex: number;
  totalPages: number;
  pageSize: { width: number; height: number };
}

const inputClass = 'w-full px-2 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-amber-400';
const buttonClass = 'flex items-center justify-center gap-1 px-2 py-2 text-xs font-medium rounded-lg border border-gray-200 hover:bg-amber-50 hover:border-amber-300 disabled:opacity-40 disabled:cursor-not-allowed';
const shapeOptions: { kind: PdfGraphic['kind']; label: string }[] = [
  { kind: 'rectangle', label: '四角形' },
  { kind: 'ellipse', label: '楕円' },
  { kind: 'line', label: '直線' },
  { kind: 'arrow', label: '矢印' },
  { kind: 'highlight', label: '蛍光マーカー' },
];

async function readImage(file: File): Promise<{ dataUrl: string; width: number; height: number }> {
  if (file.size > 20 * 1024 * 1024) throw new Error('画像は 20 MB 以下にしてください。');
  const bytes = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  const png = bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value);
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (!png && !jpeg) throw new Error('PNG または JPEG 画像を選んでください。');
  // Use the detected format even when a file has an empty or incorrect MIME type.
  const blob = new Blob([file], { type: png ? 'image/png' : 'image/jpeg' });
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('画像を読み込めませんでした。'));
    reader.onerror = () => reject(new Error('画像を読み込めませんでした。'));
    reader.readAsDataURL(blob);
  });
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 40_000_000) {
        reject(new Error('画像の大きさを 4,000 万画素以下にしてください。'));
      } else {
        // Rasterize once so EXIF orientation and the PDF embedding agree.
        const canvas = document.createElement('canvas');
        const scale = Math.min(1, 4096 / Math.max(image.naturalWidth, image.naturalHeight));
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        const context = canvas.getContext('2d');
        if (!context) { reject(new Error('画像を処理できませんでした。')); return; }
        try {
          context.drawImage(image, 0, 0, canvas.width, canvas.height);
          resolve({ dataUrl: canvas.toDataURL(png ? 'image/png' : 'image/jpeg', 0.95), width: canvas.width, height: canvas.height });
        } catch {
          reject(new Error('画像を処理できませんでした。'));
        }
      }
    };
    image.onerror = () => reject(new Error('この画像を読み込めませんでした。別の PNG / JPEG をお試しください。'));
    image.src = dataUrl;
  });
}

function NumericInput({ label, value, min = 0, max = 14400, onChange }: {
  label: string; value: number; min?: number; max?: number; onChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <label className="block text-xs font-medium text-gray-600">
      {label}
      <input type="number" min={min} max={max} step={0.1} value={draft ?? Math.round(value * 100) / 100} className={`${inputClass} mt-1`} onFocus={(event) => setDraft(event.target.value)} onBlur={() => setDraft(null)} onChange={(event) => {
        setDraft(event.target.value);
        const number = event.target.valueAsNumber;
        if (Number.isFinite(number)) onChange(Math.min(max, Math.max(min, number)));
      }} />
    </label>
  );
}

function SignaturePad({ onAdd, onClose }: { onAdd: (dataUrl: string, width: number, height: number) => void; onClose: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pointerRef = useRef<number | null>(null);
  const [hasInk, setHasInk] = useState(false);
  const [color, setColor] = useState('#172554');
  const position = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = event.currentTarget;
    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.min(canvas.width, Math.max(0, (event.clientX - rect.left) * canvas.width / rect.width)),
      y: Math.min(canvas.height, Math.max(0, (event.clientY - rect.top) * canvas.height / rect.height)),
    };
  };
  const stopDrawing = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (event.pointerId !== pointerRef.current) return;
    pointerRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const addSignature = () => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context || !hasInk) return;
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let left = canvas.width, top = canvas.height, right = -1, bottom = -1;
    for (let y = 0; y < canvas.height; y++) {
      for (let x = 0; x < canvas.width; x++) {
        if (pixels[(y * canvas.width + x) * 4 + 3] > 0) {
          left = Math.min(left, x); right = Math.max(right, x);
          top = Math.min(top, y); bottom = Math.max(bottom, y);
        }
      }
    }
    if (right < left) return;
    const cropped = document.createElement('canvas');
    cropped.width = right - left + 21;
    cropped.height = bottom - top + 21;
    const croppedContext = cropped.getContext('2d');
    if (!croppedContext) return;
    croppedContext.drawImage(canvas, left, top, right - left + 1, bottom - top + 1, 10, 10, right - left + 1, bottom - top + 1);
    onAdd(cropped.toDataURL('image/png'), cropped.width, cropped.height);
  };

  return (
    <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50/50 p-3">
      <p className="text-sm font-medium text-gray-700">手書きサイン</p>
      <p className="text-xs text-gray-600">下の枠にマウスや指で記入します。画像として追加されるサインです。電子証明書によるデジタル署名は付与しません。</p>
      <canvas ref={canvasRef} width={640} height={200} aria-label="手書きサインの記入欄" className="w-full rounded border border-gray-300 bg-white touch-none cursor-crosshair"
        onPointerDown={(event) => {
          if (!event.isPrimary || event.button !== 0 || pointerRef.current !== null) return;
          const context = event.currentTarget.getContext('2d');
          if (!context) return;
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          pointerRef.current = event.pointerId;
          const { x, y } = position(event);
          context.strokeStyle = color; context.fillStyle = color; context.lineWidth = 4;
          context.lineCap = 'round'; context.lineJoin = 'round';
          context.beginPath(); context.arc(x, y, 2, 0, Math.PI * 2); context.fill();
          context.beginPath(); context.moveTo(x, y);
          setHasInk(true);
        }}
        onPointerMove={(event) => {
          if (pointerRef.current !== event.pointerId) return;
          const context = event.currentTarget.getContext('2d');
          if (!context) return;
          const { x, y } = position(event);
          context.lineTo(x, y); context.stroke(); context.beginPath(); context.moveTo(x, y);
        }}
        onPointerUp={stopDrawing} onPointerCancel={stopDrawing} onLostPointerCapture={() => { pointerRef.current = null; }}
      />
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1 text-xs text-gray-600">ペンの色<input type="color" value={color} onChange={(event) => setColor(event.target.value)} className="h-7 w-8" /></label>
        <button className={buttonClass} onClick={() => {
          const canvas = canvasRef.current;
          canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
          setHasInk(false);
        }}>書き直す</button>
        <button className={buttonClass} disabled={!hasInk} onClick={addSignature}>サインを追加</button>
        <button className={buttonClass} onClick={onClose}>閉じる</button>
      </div>
    </div>
  );
}

export function GraphicsEditor({ graphics, onChange, activeGraphicId, onActiveChange, currentPageIndex, totalPages, pageSize }: GraphicsEditorProps) {
  const [showSignature, setShowSignature] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unlockedImages, setUnlockedImages] = useState<Record<string, boolean>>({});
  const fileRef = useRef<HTMLInputElement>(null);
  const mounted = useRef(false);
  const uploadVersion = useRef(0);
  const latest = useRef({ graphics, onChange, onActiveChange, totalPages, currentPageIndex });
  useEffect(() => {
    latest.current = { graphics, onChange, onActiveChange, totalPages, currentPageIndex };
  }, [graphics, onChange, onActiveChange, totalPages, currentPageIndex]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const active = graphics.find((graphic) => graphic.id === activeGraphicId);
  const update = (changes: Partial<PdfGraphic>) => {
    if (active) onChange(graphics.map((graphic) => graphic.id === active.id ? { ...graphic, ...changes } : graphic));
  };
  const addGraphic = (kind: PdfGraphic['kind']) => {
    const graphic = createDefaultGraphic(kind, currentPageIndex);
    graphic.width = Math.min(graphic.width, pageSize.width);
    graphic.height = Math.min(graphic.height, pageSize.height);
    graphic.x = Math.max(0, Math.min(graphic.x, pageSize.width - graphic.width));
    graphic.y = Math.max(0, Math.min(graphic.y, pageSize.height - graphic.height));
    onChange([...graphics, graphic]);
    onActiveChange(graphic.id);
  };
  const makeImage = (dataUrl: string, imageWidth: number, imageHeight: number, label: string, pageIndex: number, size: { width: number; height: number }) => {
    const graphic = createDefaultGraphic('image', pageIndex);
    const scale = Math.min(200 / imageWidth, size.width / imageWidth, size.height / imageHeight);
    graphic.width = imageWidth * scale; graphic.height = imageHeight * scale;
    graphic.x = Math.max(0, Math.min(graphic.x, size.width - graphic.width));
    graphic.y = Math.max(0, Math.min(graphic.y, size.height - graphic.height));
    graphic.imageDataUrl = dataUrl;
    graphic.label = label.slice(0, 120);
    return graphic;
  };
  const importImage = async (file: File) => {
    const version = ++uploadVersion.current;
    const targetPage = currentPageIndex;
    const targetTotalPages = totalPages;
    setUploading(true); setError(null);
    try {
      const image = await readImage(file);
      if (!mounted.current || version !== uploadVersion.current) return;
      const current = latest.current;
      if (current.totalPages !== targetTotalPages || current.currentPageIndex !== targetPage) {
        setError('読み込み中にページが変わりました。追加先のページで画像を選び直してください。');
        return;
      }
      const graphic = makeImage(image.dataUrl, image.width, image.height, file.name, targetPage, pageSize);
      current.onChange([...current.graphics, graphic]);
      current.onActiveChange(graphic.id);
    } catch (cause) {
      if (mounted.current && version === uploadVersion.current) setError(cause instanceof Error ? cause.message : '画像を読み込めませんでした。');
    } finally {
      if (mounted.current && version === uploadVersion.current) setUploading(false);
    }
  };
  const resize = (axis: 'width' | 'height', value: number) => {
    if (!active) return;
    if ((active.kind === 'line' || active.kind === 'arrow') && value === 0 && active[axis === 'width' ? 'height' : 'width'] === 0) return;
    if (active.kind === 'image' && !unlockedImages[active.id]) {
      const ratio = active.width / active.height;
      if (axis === 'width') {
        const width = Math.min(value, 14400 * ratio);
        update({ width, height: width / ratio });
      } else {
        const height = Math.min(value, 14400 / ratio);
        update({ height, width: height * ratio });
      }
    } else update({ [axis]: value });
  };
  const removeActive = () => {
    if (!active) return;
    onChange(graphics.filter((graphic) => graphic.id !== active.id));
    onActiveChange(null);
  };
  const line = active?.kind === 'line' || active?.kind === 'arrow';

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-gray-700">画像・図形・サイン</h3>
      <div className="grid grid-cols-3 gap-2">
        {shapeOptions.map(({ kind, label }) => <button key={kind} className={buttonClass} onClick={() => addGraphic(kind)}>{label}</button>)}
        <button className={buttonClass} disabled={uploading} onClick={() => fileRef.current?.click()}><ImagePlus className="h-4 w-4 shrink-0" />{uploading ? '読込中…' : '画像'}</button>
      </div>
      <input ref={fileRef} type="file" accept="image/png,image/jpeg,.png,.jpg,.jpeg" aria-label="追加する PNG / JPEG 画像" className="hidden" onChange={(event) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (file) void importImage(file);
      }} />
      <button className={`${buttonClass} w-full`} onClick={() => setShowSignature(!showSignature)} aria-expanded={showSignature}><PenLine className="h-4 w-4" />手書きサインを作成</button>
      {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
      {showSignature && <SignaturePad onClose={() => setShowSignature(false)} onAdd={(dataUrl, width, height) => {
        const graphic = makeImage(dataUrl, width, height, '手書きサイン', currentPageIndex, pageSize);
        onChange([...graphics, graphic]); onActiveChange(graphic.id); setShowSignature(false);
      }} />}
      <p className="flex gap-1.5 rounded bg-amber-50 p-2 text-xs text-amber-700"><MousePointer2 className="h-4 w-4 shrink-0" />図形を選び、プレビューでドラッグして移動できます。位置・大きさは数値でも調整できます。</p>
      {graphics.length === 0 && <p className="py-3 text-center text-xs text-gray-400">図形や画像を追加すると、ここで編集できます。</p>}
      {graphics.length > 0 && <div className="max-h-48 space-y-1 overflow-y-auto" aria-label="追加した画像と図形">
        {[...graphics].reverse().map((graphic) => <button key={graphic.id} className={`flex w-full items-center justify-between gap-2 rounded border px-2 py-2 text-left text-xs ${graphic.id === activeGraphicId ? 'border-amber-400 bg-amber-50' : 'border-gray-200 hover:bg-gray-50'}`} aria-pressed={graphic.id === activeGraphicId} onClick={() => onActiveChange(graphic.id === activeGraphicId ? null : graphic.id)}>
          <span className="truncate">{graphic.label}</span><span className="shrink-0 text-gray-400">{graphic.pageIndex === -1 ? '全ページ' : `P.${graphic.pageIndex + 1}`}</span>
        </button>)}
      </div>}
      {active && <div key={active.id} className="space-y-3 rounded-lg border border-amber-300 bg-amber-50/30 p-3">
        <label className="block text-xs font-medium text-gray-600">名前<input className={`${inputClass} mt-1`} maxLength={120} value={active.label} onChange={(event) => update({ label: event.target.value })} /></label>
        <label className="block text-xs font-medium text-gray-600">図形の対象ページ<select className={`${inputClass} mt-1`} value={active.pageIndex} onChange={(event) => update({ pageIndex: Number(event.target.value) })}>
          <option value={-1}>全ページ</option>
          {Array.from({ length: totalPages }, (_, index) => <option key={index} value={index}>{index + 1} ページ{index === currentPageIndex ? '（表示中）' : ''}</option>)}
        </select></label>
        <p className="text-xs text-gray-500">左上を基準に配置します。1 pt ≒ 0.35 mm</p>
        <div className="grid grid-cols-2 gap-2">
          <NumericInput label="左から (pt)" value={active.x} onChange={(x) => update({ x })} />
          <NumericInput label="上から (pt)" value={active.y} onChange={(y) => update({ y })} />
          <NumericInput label={line ? '横方向 (pt)' : '幅 (pt)'} value={active.width} min={line ? -14400 : 1} onChange={(value) => resize('width', value)} />
          <NumericInput label={line ? '縦方向 (pt)' : '高さ (pt)'} value={active.height} min={line ? -14400 : 1} onChange={(value) => resize('height', value)} />
        </div>
        {line && <p className="text-xs text-gray-500">横方向が負なら左向き、縦方向が負なら上向きになります。</p>}
        {active.kind === 'image' && <label className="flex items-center gap-2 text-xs text-gray-600"><input type="checkbox" checked={!unlockedImages[active.id]} onChange={(event) => setUnlockedImages({ ...unlockedImages, [active.id]: !event.target.checked })} />縦横比を維持</label>}
        {active.kind !== 'image' && <>
          {active.kind !== 'highlight' && <div className="grid grid-cols-2 gap-2">
            <label className="block text-xs font-medium text-gray-600">線の色<input type="color" className="mt-1 block h-9 w-full rounded border border-gray-300" value={active.color} onChange={(event) => update({ color: event.target.value })} /></label>
            <NumericInput label="線の太さ (pt)" value={active.lineWidth} min={line ? 0.1 : 0} max={30} onChange={(lineWidth) => update({ lineWidth })} />
          </div>}
          {!line && <div className="space-y-2">
            {active.kind !== 'highlight' && <label className="flex items-center gap-2 text-xs text-gray-600">
              <input type="checkbox" checked={active.fillColor !== 'transparent'} onChange={(event) => update({ fillColor: event.target.checked ? '#facc15' : 'transparent' })} />塗りつぶし
            </label>}
            {(active.fillColor !== 'transparent' || active.kind === 'highlight') && <label className="flex items-center gap-2 text-xs text-gray-600">塗りつぶしの色<input type="color" className="h-8 w-10 rounded border border-gray-300" value={active.fillColor === 'transparent' ? active.color : active.fillColor} onChange={(event) => update({ fillColor: event.target.value })} /></label>}
          </div>}
        </>}
        <label className="block text-xs font-medium text-gray-600">不透明度: {Math.round(active.opacity * 100)}%<input type="range" min={5} max={100} value={Math.round(active.opacity * 100)} className="mt-2 block w-full accent-amber-500" onChange={(event) => update({ opacity: Number(event.target.value) / 100 })} /></label>
        <div className="grid grid-cols-2 gap-2">
          <button className={buttonClass} onClick={() => {
            const duplicate = { ...active, id: createDefaultGraphic(active.kind, active.pageIndex).id, x: Math.min(active.x + 12, Math.max(0, pageSize.width - active.width)), y: Math.min(active.y + 12, Math.max(0, pageSize.height - active.height)), label: `${active.label}（コピー）`.slice(0, 120) };
            onChange([...graphics, duplicate]); onActiveChange(duplicate.id);
          }}><Copy className="h-3.5 w-3.5" />複製</button>
          <button className={`${buttonClass} text-red-600`} onClick={removeActive}><Trash2 className="h-3.5 w-3.5" />削除</button>
          <button className={buttonClass} disabled={graphics.at(-1)?.id === active.id} onClick={() => onChange([...graphics.filter((graphic) => graphic.id !== active.id), active])}><ArrowUpToLine className="h-3.5 w-3.5" />最前面へ</button>
          <button className={buttonClass} disabled={graphics[0]?.id === active.id} onClick={() => onChange([active, ...graphics.filter((graphic) => graphic.id !== active.id)])}><ArrowDownToLine className="h-3.5 w-3.5" />最背面へ</button>
        </div>
        <p className="text-xs text-gray-500">重なり順は追加した図形・画像の間で変更します。</p>
      </div>}
    </div>
  );
}
