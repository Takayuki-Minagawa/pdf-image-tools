import { useCallback, useEffect, useRef, useState } from 'react';
import * as pdfjs from 'pdfjs-dist';
import type { DocumentInitParameters } from 'pdfjs-dist/types/src/display/api';
import { Download, FileCheck2, Plus, Redo2, ShieldCheck, Trash2, Undo2 } from 'lucide-react';
import { REGION_REDACTION_LIMITS, type RegionPageInfo, type RegionRedactionRegion, type RegionRedactionSettings } from '../types/regionRedaction';
import { parseRecipe, requireRegionOnlyRecipe } from '../types/recipe';
import { describeDocument, estimateRegionRedaction, rasterizeAndVerify } from '../utils/regionRedaction';
import { prepareSecurePdfAssets } from '../utils/securePdfAssets';
import { deletePdfDraft } from '../utils/draftStorage';
import { downloadBlob } from '../utils/download';
import { ensurePdfjsWorker } from '../utils/pdfjsWorker';
import { sendPdfToEditor } from '../utils/workflowHandoff';
import { mismatchedRegionPages, mmToPoint, parseRegionPages, pointToMm } from '../utils/regionUi';

const INITIAL: RegionRedactionSettings = { version: 1, dpi: 150, regions: [] };
const controlBase = 'rounded-md border px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 disabled:opacity-40';
const control = `${controlBase} border-gray-300`;
const buttonBase = `${controlBase} inline-flex items-center justify-center gap-1.5`;
const button = `${buttonBase} border-gray-300 bg-white hover:bg-gray-50`;
const primary = `${buttonBase} border-teal-700 bg-teal-700 font-semibold text-white hover:bg-teal-800`;
const formatMm = (pt: number) => pointToMm(pt).toFixed(1);
const editableMm = (pt: number) => String(Math.round(pointToMm(pt) * 1_000_000) / 1_000_000);
type Candidate = Awaited<ReturnType<typeof rasterizeAndVerify>>;
type RectDraft = { x: string; y: string; width: string; height: string };
const EMPTY_RECT: RectDraft = { x: '0', y: '0', width: '50', height: '20' };

function PdfRegionPreview({ bytes, pageNumber, page, options, zoom, regions, onRectangle, onReady }: {
  bytes: Uint8Array;
  pageNumber: number;
  page: RegionPageInfo;
  options: Partial<DocumentInitParameters>;
  zoom: number;
  regions: RegionRedactionRegion[];
  onRectangle?: (rect: { x: number; y: number; width: number; height: number }) => void;
  onReady: (pageNumber: number) => void;
}) {
  const [rendered, setRendered] = useState<{ bytes: Uint8Array; pageNumber: number; zoom: number; url?: string; failed?: boolean } | null>(null);
  const [drag, setDrag] = useState<{ x: number; y: number; endX: number; endY: number } | null>(null);
  const onReadyRef = useRef(onReady);
  useEffect(() => { onReadyRef.current = onReady; }, [onReady]);
  useEffect(() => {
    let disposed = false;
    ensurePdfjsWorker();
    const task = pdfjs.getDocument({ ...options, data: bytes.slice(), isEvalSupported: false, verbosity: 0 });
    let canvas: HTMLCanvasElement | null = null;
    void (async () => {
      try {
        const pdf = await task.promise;
        const pdfPage = await pdf.getPage(pageNumber);
        const base = pdfPage.getViewport({ scale: 1 });
        const viewport = pdfPage.getViewport({ scale: 1600 * zoom / Math.max(base.width, base.height) });
        canvas = document.createElement('canvas');
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        const context = canvas.getContext('2d');
        if (!context) throw new Error('canvas');
        await pdfPage.render({ canvas, canvasContext: context, viewport, annotationMode: pdfjs.AnnotationMode.DISABLE, background: '#ffffff' }).promise;
        if (!disposed) {
          setRendered({ bytes, pageNumber, zoom, url: canvas.toDataURL('image/png') });
          onReadyRef.current(pageNumber);
        }
      } catch {
        if (!disposed) setRendered({ bytes, pageNumber, zoom, failed: true });
      } finally {
        if (canvas) { canvas.width = 0; canvas.height = 0; }
        await task.destroy();
      }
    })();
    return () => { disposed = true; void task.destroy(); };
  }, [bytes, pageNumber, options, zoom]);
  const current = rendered?.bytes === bytes && rendered.pageNumber === pageNumber && rendered.zoom === zoom ? rendered : null;
  if (current?.failed) return <p role="alert" className="p-6 text-red-700">ページを表示できません。確認済みにはできません。</p>;
  if (!current?.url) return <p role="status" className="p-6 text-gray-600">ページ {pageNumber} を描画中…</p>;
  const position = (event: React.PointerEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(page.width, (event.clientX - box.left) / box.width * page.width)),
      y: Math.max(0, Math.min(page.height, (event.clientY - box.top) / box.height * page.height)),
    };
  };
  return (
    <div className={`relative mx-auto shrink-0 bg-white shadow ${zoom === 1 ? 'max-w-full' : ''}`} style={{ aspectRatio: `${page.width}/${page.height}`, width: Math.min(740, page.width * 1.4) * zoom }}>
      <img src={current.url} alt={`ページ ${pageNumber} のローカルプレビュー`} className="block h-full w-full" draggable={false} />
      <svg
        viewBox={`0 0 ${page.width} ${page.height}`}
        className={`absolute inset-0 h-full w-full ${onRectangle ? 'cursor-crosshair touch-none' : 'pointer-events-none'}`}
        aria-label={onRectangle ? '領域指定プレビュー。ドラッグまたは下の数値欄で矩形を指定' : '除去後の確認プレビュー'}
        onPointerDown={(event) => {
          if (!onRectangle || event.button !== 0) return;
          const p = position(event);
          event.currentTarget.setPointerCapture(event.pointerId);
          setDrag({ ...p, endX: p.x, endY: p.y });
        }}
        onPointerMove={(event) => {
          if (!drag) return;
          const p = position(event);
          setDrag({ ...drag, endX: p.x, endY: p.y });
        }}
        onPointerCancel={() => setDrag(null)}
        onPointerUp={(event) => {
          if (!drag || !onRectangle) return;
          const p = position(event);
          const rect = { x: Math.min(drag.x, p.x), y: Math.min(drag.y, p.y), width: Math.abs(p.x - drag.x), height: Math.abs(p.y - drag.y) };
          setDrag(null);
          if (rect.width > 0.5 && rect.height > 0.5) onRectangle(rect);
        }}
      >
        {regions.map((region, index) => (
          <g key={region.id}>
            <rect x={region.x} y={region.y} width={region.width} height={region.height} fill="#0d9488" fillOpacity="0.25" stroke="#0f766e" strokeWidth="1.5" />
            <text x={region.x + 3} y={region.y + 12} fill="#115e59" fontSize="11">{index + 1}</text>
          </g>
        ))}
        {drag && <rect x={Math.min(drag.x, drag.endX)} y={Math.min(drag.y, drag.endY)} width={Math.abs(drag.endX - drag.x)} height={Math.abs(drag.endY - drag.y)} fill="#06b6d4" fillOpacity="0.2" stroke="#0891b2" />}
      </svg>
    </div>
  );
}

export default function RegionPreprocessor() {
  const [assetOptions, setAssetOptions] = useState<Partial<DocumentInitParameters> | null>(null);
  const [startupError, setStartupError] = useState(false);
  const [source, setSource] = useState<Uint8Array | null>(null);
  const [pages, setPages] = useState<RegionPageInfo[]>([]);
  const [pageNumber, setPageNumber] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [settings, setSettings] = useState<RegionRedactionSettings>(INITIAL);
  const [history, setHistory] = useState([{ settings: INITIAL, label: '開始' }]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [rect, setRect] = useState<RectDraft>(EMPTY_RECT);
  const [pageRange, setPageRange] = useState('1');
  const [fill, setFill] = useState<'white' | 'black'>('white');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [previewMode, setPreviewMode] = useState<'original' | 'candidate'>('original');
  const [reviewedPages, setReviewedPages] = useState<number[]>([]);
  const [renderedCandidatePage, setRenderedCandidatePage] = useState<number | null>(null);
  const [approved, setApproved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('必要な描画資源を端末に準備しています…');
  const [error, setError] = useState('');
  const generationRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const endPendingOperations = useCallback(() => { generationRef.current++; abortRef.current?.abort(); }, []);

  useEffect(() => {
    let disposed = false;
    void (async () => {
      try {
        // Never read the confidential input until existing persistent drafts are gone.
        await deletePdfDraft();
        const options = await prepareSecurePdfAssets();
        if (!disposed) {
          setAssetOptions(options);
          setStatus('準備完了。原本を読み込めます。原本の下書きは保存しません。');
        }
      } catch {
        if (!disposed) {
          setStartupError(true);
          setStatus('下書きの削除または描画資源の準備に失敗しました。原本は読み込めません。再読み込みしてやり直してください。');
        }
      }
    })();
    return () => { disposed = true; endPendingOperations(); };
  }, [endPendingOperations]);

  const invalidate = () => {
    setCandidate(null); setReviewedPages([]); setRenderedCandidatePage(null); setApproved(false); setPreviewMode('original');
  };
  const commit = (next: RegionRedactionSettings, label: string) => {
    invalidate(); setError(''); setSettings(next);
    const nextHistory = [...history.slice(0, historyIndex + 1), { settings: next, label }].slice(-50);
    setHistory(nextHistory); setHistoryIndex(nextHistory.length - 1); setStatus(label);
  };
  const restore = (index: number) => {
    const entry = history[index];
    if (!entry) return;
    invalidate(); setSettings(entry.settings); setHistoryIndex(index); setEditingId(null); setStatus(`${entry.label} の状態に戻しました。`);
  };
  const loadFile = async (file: File) => {
    if (!assetOptions || busy) return;
    const generation = ++generationRef.current;
    const controller = new AbortController(); abortRef.current = controller;
    setBusy(true); setError(''); invalidate(); setSource(null); setPages([]);
    setStatus('原本を端末内で読み込んでいます…');
    try {
      await deletePdfDraft();
      if (file.size > REGION_REDACTION_LIMITS.maxInputBytes) throw new Error('input-limit');
      const bytes = new Uint8Array(await file.arrayBuffer());
      controller.signal.throwIfAborted();
      if (generation !== generationRef.current) return;
      const loadedPages = await describeDocument(bytes, { documentOptions: assetOptions, signal: controller.signal });
      if (generation !== generationRef.current) return;
      setSource(bytes); setPages(loadedPages); setPageNumber(1); setZoom(1); setPageRange('1');
      setSettings(INITIAL); setHistory([{ settings: INITIAL, label: '開始' }]); setHistoryIndex(0); setEditingId(null); setRect(EMPTY_RECT);
      setStatus(`${loadedPages.length} ページを読み込みました。領域を指定してください。`);
    } catch {
      if (generation === generationRef.current) {
        if (controller.signal.aborted) setStatus('原本の読み込みを中止しました。');
        else setError('PDFを読み込めません。128 MiB以下の、暗号化されていない正常なPDFを使用してください。下書きの削除に失敗した場合も停止します。');
      }
    } finally {
      if (generation === generationRef.current) setBusy(false);
      if (abortRef.current === controller) abortRef.current = null;
    }
  };
  const currentPage = pages.find((page) => page.pageNumber === pageNumber);
  const mismatches = settings.regions.flatMap((region, index) => mismatchedRegionPages(region, pages).map((number) => ({ region, number, index })));
  let estimate: ReturnType<typeof estimateRegionRedaction> | null = null;
  let estimateError = '';
  if (pages.length) {
    try { estimate = estimateRegionRedaction(pages, settings); }
    catch (cause) { estimateError = cause instanceof Error ? cause.message : '処理条件を確認してください。'; }
  }
  const saveRegion = () => {
    if (!currentPage) return;
    try {
      const selectedPages = parseRegionPages(pageRange, pages.length);
      const values = Object.fromEntries(Object.entries(rect).map(([key, value]) => {
        if (!value.trim() || !Number.isFinite(Number(value))) throw new Error('座標と寸法には数値を入力してください。');
        return [key, mmToPoint(Number(value))];
      })) as { x: number; y: number; width: number; height: number };
      if (values.x < 0 || values.y < 0 || values.width <= 0 || values.height <= 0 || values.x + values.width > currentPage.width + 0.001 || values.y + values.height > currentPage.height + 0.001) {
        throw new Error('領域は表示ページ内に収まる、幅・高さが正の矩形で指定してください。');
      }
      const region: RegionRedactionRegion = { id: editingId ?? crypto.randomUUID(), pages: selectedPages, ...values, pageWidth: currentPage.width, pageHeight: currentPage.height, fill };
      commit({ ...settings, regions: editingId ? settings.regions.map((item) => item.id === editingId ? region : item) : [...settings.regions, region] }, editingId ? '領域を更新しました。' : '領域を追加しました。');
      setEditingId(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '領域を確認してください。'); }
  };
  const generate = async () => {
    if (!source || !assetOptions || !estimate || busy) return;
    const generation = ++generationRef.current;
    const controller = new AbortController(); abortRef.current = controller;
    setBusy(true); setError(''); invalidate();
    try {
      const result = await rasterizeAndVerify(source, settings, {
        documentOptions: assetOptions,
        signal: controller.signal,
        onProgress: ({ stage, page, total }) => {
          if (generation === generationRef.current) setStatus(`${stage === 'rendering' ? '画素を除去して新規作成' : '出力を再読込みして検証'}: ${page} / ${total} ページ`);
        },
      });
      if (generation !== generationRef.current || controller.signal.aborted) return;
      setCandidate(result); setPreviewMode('candidate'); setPageNumber(1);
      setStatus('機械検証が完了しました。除去後の全ページを確認して承認してください。');
    } catch (cause) {
      if (generation !== generationRef.current) return;
      if (controller.signal.aborted) setStatus('処理を中止しました。候補は保存していません。');
      else setError(cause instanceof Error ? cause.message : '処理または検証に失敗しました。保存できません。');
    } finally {
      if (generation === generationRef.current) setBusy(false);
      if (abortRef.current === controller) abortRef.current = null;
    }
  };
  const candidateReady = useCallback((number: number) => setRenderedCandidatePage(number), []);
  const originalReady = useCallback(() => undefined, []);
  const allReviewed = Boolean(candidate && pages.length && reviewedPages.length === pages.length);
  const canRelease = Boolean(candidate && allReviewed && approved && !busy);
  const downloadApproved = () => {
    if (!canRelease || !candidate) return;
    downloadBlob(new Blob([new Uint8Array(candidate.bytes)], { type: 'application/pdf' }), 'approved.pdf');
    setStatus('承認済みPDFを保存しました。原本と別の承認済み出力専用フォルダーで扱ってください。');
  };
  const handoff = () => {
    if (!canRelease || !candidate) return;
    const approvedBytes = candidate.bytes;
    generationRef.current++; abortRef.current?.abort();
    setSource(null); setCandidate(null); setPages([]); setHistory([]); setSettings(INITIAL); setRect(EMPTY_RECT);
    sendPdfToEditor(approvedBytes, 'approved.pdf');
  };
  const importTemplate = async (file: File) => {
    if (busy) return;
    const generation = ++generationRef.current;
    const controller = new AbortController(); abortRef.current = controller;
    setBusy(true); setError(''); setStatus('領域テンプレートを読み込んでいます…');
    try {
      if (file.size > 1024 * 1024) throw new Error('size');
      const importedSettings = requireRegionOnlyRecipe(parseRecipe(JSON.parse(await file.text())));
      if (generation !== generationRef.current || controller.signal.aborted) return;
      commit(importedSettings, '領域テンプレートを読み込みました。用紙と対象ページを確認してください。');
      setEditingId(null);
    } catch {
      if (generation === generationRef.current && !controller.signal.aborted) setError('領域除去設定だけを含む、1 MB以下のレシピJSONを選んでください。通常編集との混在はできません。');
    } finally {
      if (generation === generationRef.current) { setBusy(false); if (controller.signal.aborted) setStatus('テンプレートの読み込みを中止しました。'); }
      if (abortRef.current === controller) abortRef.current = null;
    }
  };

  return (
    <div className="space-y-5" aria-busy={busy}>
      <div className="flex items-start gap-3">
        <ShieldCheck className="mt-1 h-6 w-6 shrink-0 text-teal-700" aria-hidden="true" />
        <div><h2 className="text-xl font-bold text-gray-900">領域除去・ローカル前処理</h2><p className="mt-1 text-sm text-gray-600">表題欄・ロゴ・線を画素から除去し、すべてのページを画像だけの新しいPDFにします。</p></div>
      </div>
      <div className="space-y-1 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-950">
        <p>文字検索・ベクター編集は失われます。注釈・フォームの表示は含めません。出力寸法は回転後の可視範囲（CropBox）を維持します。</p>
        <p>機密原本を開く前に、外部computer useの画面・ファイルアクセスを切り離してください。この画面はOSのアクセス権を制限しません。外部操作には目視承認後の出力だけを渡してください。</p>
        <p>原本の下書きは保存しません。ほかのツールの作業セッションと既存の編集下書きは、この画面への移動時に終了・削除されます。</p>
      </div>
      <div role={startupError ? 'alert' : 'status'} aria-live="polite" id="region-status" className="rounded-lg bg-teal-50 p-3 text-sm text-teal-950">{status}</div>
      {busy && <button id="region-cancel" type="button" className={button} onClick={() => { abortRef.current?.abort(); setStatus('処理の中止を待っています…'); }}>処理を中止</button>}
      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      <label htmlFor="region-source-file" className="block text-sm font-medium text-gray-800">ローカル原本PDF（128 MiB以下）</label>
      <input id="region-source-file" type="file" accept="application/pdf,.pdf" disabled={!assetOptions || busy} className={`${control} block w-full`} onChange={(event) => {
        const file = event.currentTarget.files?.[0]; event.currentTarget.value = '';
        if (file) void loadFile(file);
      }} />
      {source && currentPage && assetOptions && <>
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="region-page" className="text-sm font-medium">表示ページ</label>
          <select id="region-page" value={pageNumber} disabled={busy} className={control} onChange={(event) => { setPageNumber(Number(event.target.value)); setRenderedCandidatePage(null); }}>
            {pages.map((page) => <option key={page.pageNumber} value={page.pageNumber}>{page.pageNumber} / {pages.length}{reviewedPages.includes(page.pageNumber) ? ' 確認済み' : ''}</option>)}
          </select>
          <span className="text-sm text-gray-600">{formatMm(currentPage.width)} × {formatMm(currentPage.height)} mm（回転 {currentPage.rotation}°）</span>
          <label htmlFor="region-preview-zoom" className="text-sm">表示倍率<select id="region-preview-zoom" className={`${control} ml-2`} value={zoom} disabled={busy} onChange={(event) => { setZoom(Number(event.target.value)); setRenderedCandidatePage(null); }}><option value={1}>100%</option><option value={2}>200%</option><option value={3}>300%</option></select></label>
          {candidate && <div className="ml-auto flex gap-2" role="group" aria-label="処理前後の比較">
            <button type="button" className={button} aria-pressed={previewMode === 'original'} onClick={() => setPreviewMode('original')}>処理前</button>
            <button type="button" className={button} aria-pressed={previewMode === 'candidate'} onClick={() => { if (previewMode !== 'candidate') { setPreviewMode('candidate'); setRenderedCandidatePage(null); } }}>除去後</button>
          </div>}
        </div>
        <div className="max-h-[75vh] overflow-auto rounded-lg border border-gray-300 bg-gray-100 p-2 sm:p-4">
          <PdfRegionPreview key={previewMode} bytes={previewMode === 'candidate' && candidate ? candidate.bytes : source} pageNumber={pageNumber} page={currentPage} options={assetOptions} zoom={zoom}
            regions={previewMode === 'original' ? settings.regions.filter((region) => region.pages.includes(pageNumber)) : []}
            onReady={previewMode === 'candidate' ? candidateReady : originalReady}
            onRectangle={!busy && previewMode === 'original' ? (value) => {
              invalidate(); setRect({ x: editableMm(value.x), y: editableMm(value.y), width: editableMm(value.width), height: editableMm(value.height) });
              setPageRange(String(pageNumber)); setEditingId(null); setStatus('ドラッグした領域を数値欄に反映しました。「領域を追加」で確定してください。');
            } : undefined} />
        </div>
        {candidate && <div className="space-y-3 rounded-lg border border-teal-200 bg-teal-50 p-4">
          <h3 className="font-bold text-teal-950">出力候補の確認</h3>
          <p className="text-sm text-teal-950">構造・文字抽出・画素・原本不変の検証が完了。指定範囲以外に残る機密情報や細線の欠落は、拡大も使って人が確認してください。確認状況: {reviewedPages.length} / {pages.length} ページ</p>
          <button id="region-review-page" type="button" className={button} disabled={previewMode !== 'candidate' || renderedCandidatePage !== pageNumber} onClick={() => {
            setReviewedPages((current) => current.includes(pageNumber) ? current : [...current, pageNumber]);
            setStatus(`ページ ${pageNumber} を目視確認済みにしました。`);
          }}><FileCheck2 className="h-4 w-4" aria-hidden="true" />ページ {pageNumber} の除去後を目視確認済みにする</button>
          <label className="flex items-start gap-2 text-sm"><input id="region-approval" type="checkbox" checked={approved} disabled={!allReviewed} onChange={(event) => setApproved(event.target.checked)} className="mt-1" /><span>全ページを確認し、外部に渡してよい内容であると承認する</span></label>
          <div className="flex flex-wrap gap-2">
            <button id="region-save-approved" type="button" disabled={!canRelease} onClick={downloadApproved} className={primary}><Download className="h-4 w-4" aria-hidden="true" />承認済みPDFを保存</button>
            <button type="button" disabled={!canRelease} className={button} onClick={() => {
              if (candidate) downloadBlob(new Blob([JSON.stringify({ ...candidate.report, approval: 'human-reviewed', reviewedPageCount: reviewedPages.length }, null, 2)], { type: 'application/json' }), 'approved-report.json');
            }}>検証レポートを保存</button>
            <button id="region-approved-handoff" type="button" disabled={!canRelease} onClick={handoff} className={button}>原本セッションを終了して承認済みPDFを編集</button>
          </div>
          <p className="text-xs leading-5 text-teal-900">編集画面には承認済みPDFだけを渡します。外部computer use用の実行環境・フォルダーは別途分離してください。ブラウザーやOSのメモリ完全消去を保証するものではありません。</p>
        </div>}
        <fieldset disabled={busy} className="space-y-4 rounded-lg border border-gray-200 p-4">
          <legend className="px-1 font-bold">矩形の指定（表示ページの左上基準・mm）</legend>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {(['x', 'y', 'width', 'height'] as const).map((key) => <label key={key} htmlFor={`region-${key}`} className="text-sm font-medium">{({ x: 'X（左から）', y: 'Y（上から）', width: '幅', height: '高さ' })[key]} mm
              <input id={`region-${key}`} type="number" min="0" step="0.1" value={rect[key]} className={`${control} mt-1 w-full`} onChange={(event) => { invalidate(); setRect({ ...rect, [key]: event.target.value }); }} />
            </label>)}
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <label htmlFor="region-pages" className="flex-1 text-sm font-medium">対象ページ（例: 1-3,5 / all）<input id="region-pages" value={pageRange} className={`${control} mt-1 w-full`} onChange={(event) => { invalidate(); setPageRange(event.target.value); }} /></label>
            <label htmlFor="region-fill" className="text-sm font-medium">塗り色<select id="region-fill" value={fill} className={`${control} mt-1 block`} onChange={(event) => { invalidate(); setFill(event.target.value as 'white' | 'black'); }}><option value="white">白</option><option value="black">黒</option></select></label>
            <button id="region-add" type="button" className={primary} onClick={saveRegion}><Plus className="h-4 w-4" aria-hidden="true" />{editingId ? '領域を更新' : '領域を追加'}</button>
            {editingId && <button type="button" className={button} onClick={() => setEditingId(null)}>新規の領域に切替</button>}
          </div>
          <p className="text-xs leading-5 text-gray-600">この領域は表示ページの用紙寸法・向きを条件として保存します。違う用紙への自動拡大縮小はしません。注釈はプレビューにも表示しません。</p>
        </fieldset>
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2"><h3 className="mr-auto font-bold">確定した除去領域（{settings.regions.length}）</h3>
            <button type="button" className={button} disabled={busy || historyIndex <= 0} onClick={() => restore(historyIndex - 1)}><Undo2 className="h-4 w-4" aria-hidden="true" />元に戻す</button>
            <button type="button" className={button} disabled={busy || historyIndex >= history.length - 1} onClick={() => restore(historyIndex + 1)}><Redo2 className="h-4 w-4" aria-hidden="true" />やり直す</button>
          </div>
          {settings.regions.length === 0 && <p className="text-sm text-gray-500">領域がありません。指定なしで処理すると、全ページを画像化して新規作成します。</p>}
          <ul className="space-y-2">{settings.regions.map((region, index) => <li key={region.id} className="flex flex-wrap items-center gap-2 rounded-md border border-gray-200 p-3 text-sm">
            <span className="flex-1">領域 {index + 1}: ページ {region.pages.join(', ')} · X {formatMm(region.x)} / Y {formatMm(region.y)} / 幅 {formatMm(region.width)} / 高さ {formatMm(region.height)} mm · {region.fill === 'white' ? '白' : '黒'}</span>
            <button type="button" className={button} disabled={busy} onClick={() => { setEditingId(region.id); setRect({ x: editableMm(region.x), y: editableMm(region.y), width: editableMm(region.width), height: editableMm(region.height) }); setPageRange(region.pages.join(',')); setFill(region.fill); setPageNumber(region.pages.find((number) => pages.some((page) => page.pageNumber === number)) ?? 1); setPreviewMode('original'); }}>領域 {index + 1} を数値編集</button>
            <button type="button" className={button} disabled={busy} aria-label={`領域 ${index + 1} を削除`} onClick={() => commit({ ...settings, regions: settings.regions.filter((item) => item.id !== region.id) }, `領域 ${index + 1} を削除しました。`)}><Trash2 className="h-4 w-4" aria-hidden="true" /></button>
          </li>)}</ul>
          {mismatches.length > 0 && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-900"><p className="font-bold">用紙条件が一致しない例外ページがあります。処理は停止しています。</p><ul className="mt-2 space-y-2">{mismatches.map(({ region, number, index }) => <li key={`${region.id}-${number}`} className="flex flex-wrap gap-2"><span>領域 {index + 1} / ページ {number}</span>
            {pages.some((page) => page.pageNumber === number) && <button type="button" className={button} onClick={() => { setPageNumber(number); setPreviewMode('original'); }}>ページ {number} を確認</button>}
            <button type="button" className={button} onClick={() => commit({ ...settings, regions: settings.regions.flatMap((item) => item.id !== region.id ? [item] : item.pages.length > 1 ? [{ ...item, pages: item.pages.filter((value) => value !== number) }] : []) }, `領域 ${index + 1} の対象からページ ${number} を除外しました。`)}>この領域の対象から除外</button>
          </li>)}</ul></div>}
          <details className="text-sm text-gray-600"><summary className="cursor-pointer">操作履歴（このセッションのみ）</summary><ol className="mt-2 list-inside list-decimal">{history.map((entry, index) => <li key={index} aria-current={index === historyIndex ? 'step' : undefined}>{entry.label}{index === historyIndex ? ' ← 現在' : ''}</li>)}</ol></details>
        </div>
        <fieldset disabled={busy} className="space-y-3 rounded-lg border border-gray-200 p-4"><legend className="px-1 font-bold">出力設定とテンプレート</legend>
          <div className="flex flex-wrap items-end gap-3">
            <label htmlFor="region-dpi" className="text-sm font-medium">出力DPI<select id="region-dpi" value={settings.dpi} className={`${control} ml-2`} onChange={(event) => commit({ ...settings, dpi: Number(event.target.value) }, '出力DPIを変更しました。')}>{[...new Set([36, 72, 100, 150, 200, 300, 600, settings.dpi])].sort((a, b) => a - b).map((dpi) => <option value={dpi} key={dpi}>{dpi} dpi</option>)}</select></label>
            <button type="button" className={button} onClick={() => downloadBlob(new Blob([JSON.stringify({ version: 3, name: '領域除去設定', regionRedaction: settings }, null, 2)], { type: 'application/json' }), 'region-template.json')}>テンプレートを書出し</button>
            <label htmlFor="region-template-file" className="text-sm font-medium">テンプレートを読込み<input id="region-template-file" type="file" accept="application/json,.json" className="ml-2 max-w-full text-xs" onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file) void importTemplate(file); }} /></label>
          </div>
          {estimate && <p className="text-sm text-gray-600">全ページ {Math.ceil(estimate.totalPixels / 1_000_000)} MP · 最大ページ {Math.ceil(estimate.maxPagePixels / 1_000_000)} MP · 作業メモリ概算 {Math.ceil(estimate.estimatedWorkingBytes / 1024 / 1024)} MB · 出力容量概算上限 {Math.ceil(estimate.estimatedOutputBytes / 1024 / 1024)} MB</p>}
          {estimateError && <p role="alert" className="text-sm text-red-700">{estimateError}</p>}
          <p className="text-xs leading-5 text-gray-600">ページ単位で処理します。上限超過時は停止するためDPIを下げてください。細線・小さい文字の品質と実行可能な用紙サイズは出力で確認してください。</p>
        </fieldset>
        <div className="flex flex-wrap gap-3">
          <button id="region-process" type="button" className={primary} disabled={busy || !estimate || mismatches.length > 0} onClick={() => void generate()}>全ページを新規PDF化して検証</button>
          <button type="button" className={button} disabled={busy} onClick={() => { generationRef.current++; setSource(null); setPages([]); invalidate(); setSettings(INITIAL); setHistory([{ settings: INITIAL, label: '開始' }]); setHistoryIndex(0); setEditingId(null); setRect(EMPTY_RECT); setStatus('原本セッションを終了しました。'); }}>原本セッションを終了</button>
        </div>
      </>}
    </div>
  );
}
