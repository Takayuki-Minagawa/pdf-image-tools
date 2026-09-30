import { BookOpen, Hash, Image as ImageIcon, Save, Shapes, Type, Stamp } from 'lucide-react';
import { TextBoxEditor } from './TextBoxEditor';
import { HeaderFooterEditor } from './HeaderFooterEditor';
import { PageNumberEditor } from './PageNumberEditor';
import { ContentEditPanel } from './ContentEditPanel';
import { ImageExportSettings } from './ImageExportSettings';
import { RecipeManager } from './RecipeManager';
import { GraphicsEditor } from './GraphicsEditor';
import { WatermarkEditor } from './WatermarkEditor';
import type { PdfGraphic, WatermarkConfig } from '../../types/pdfGraphics';
import type { TextBoxConfig, HeaderFooterSettings, PageNumberingConfig, PdfImageExportOptions } from '../../types/pdfEdit';
import type { PdfEditRecipe } from '../../utils/recipeStorage';
import type { ContentEdit, RecognizedItem } from '../../types/contentEdit';

export type EditorSubTab = 'content' | 'textbox' | 'header-footer' | 'page-number' | 'graphics' | 'watermark';

interface PdfEditorSidebarProps {
  documentKey: string;
  graphics: PdfGraphic[];
  onGraphicsChange: (graphics: PdfGraphic[]) => void;
  activeGraphicId: string | null;
  onActiveGraphicChange: (id: string | null) => void;
  watermark: WatermarkConfig;
  onWatermarkChange: (config: WatermarkConfig) => void;
  currentPageIndex: number;
  pageSize: { width: number; height: number };
  activeSubTab: EditorSubTab;
  onActiveSubTabChange: (subTab: EditorSubTab) => void;
  textBoxes: TextBoxConfig[];
  onTextBoxesChange: (textBoxes: TextBoxConfig[]) => void;
  totalPages: number;
  activeTextBoxId: string | null;
  onActiveTextBoxChange: (id: string | null) => void;
  headerFooter: HeaderFooterSettings;
  onHeaderFooterChange: (settings: HeaderFooterSettings) => void;
  pageNumbering: PageNumberingConfig;
  onPageNumberingChange: (config: PageNumberingConfig) => void;
  isRecognizing: boolean;
  hasRecognized: boolean;
  recognizedItems: RecognizedItem[];
  selectedContentItem: RecognizedItem | null;
  contentEdits: ContentEdit[];
  onUpsertContentEdit: (edit: ContentEdit) => void;
  onRemoveContentEdit: (targetId: string) => void;
  onSelectContentItem: (id: string | null) => void;
  onSavePdf: () => void;
  onExportPng: () => void;
  isSavingPdf: boolean;
  isExportingPng: boolean;
  imageExportOptions: PdfImageExportOptions;
  onImageExportOptionsChange: (options: PdfImageExportOptions) => void;
  selectedPageCount: number;
  onApplyRecipe: (recipe: PdfEditRecipe) => void;
}

const SUB_TABS: { key: EditorSubTab; label: string; icon: typeof Type }[] = [
  { key: 'graphics', label: '画像・図形・署名', icon: ImageIcon },
  { key: 'watermark', label: '透かし', icon: Stamp },
  { key: 'content', label: 'コンテンツ編集', icon: Shapes },
  { key: 'textbox', label: 'テキストボックス', icon: Type },
  { key: 'header-footer', label: 'ヘッダー/フッター', icon: BookOpen },
  { key: 'page-number', label: 'ページ番号', icon: Hash },
];

export function PdfEditorSidebar({
  documentKey,
  graphics,
  onGraphicsChange,
  activeGraphicId,
  onActiveGraphicChange,
  watermark,
  onWatermarkChange,
  currentPageIndex,
  pageSize,
  activeSubTab,
  onActiveSubTabChange,
  textBoxes,
  onTextBoxesChange,
  totalPages,
  activeTextBoxId,
  onActiveTextBoxChange,
  headerFooter,
  onHeaderFooterChange,
  pageNumbering,
  onPageNumberingChange,
  isRecognizing,
  hasRecognized,
  recognizedItems,
  selectedContentItem,
  contentEdits,
  onUpsertContentEdit,
  onRemoveContentEdit,
  onSelectContentItem,
  onSavePdf,
  onExportPng,
  isSavingPdf,
  isExportingPng,
  imageExportOptions,
  onImageExportOptionsChange,
  selectedPageCount,
  onApplyRecipe,
}: PdfEditorSidebarProps) {
  return (
    <div className="shrink-0 space-y-3 lg:w-80">
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-gray-200 bg-gray-200">
        {SUB_TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.key}
              type="button"
              aria-pressed={activeSubTab === tab.key}
              onClick={() => onActiveSubTabChange(tab.key)}
              className={`flex flex-1 items-center justify-center gap-1 px-2 py-2.5 text-xs font-medium transition-colors ${
                activeSubTab === tab.key
                  ? 'bg-amber-500 text-white'
                  : 'bg-white text-gray-600 hover:bg-gray-50'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      <div className="max-h-[500px] overflow-auto rounded-lg border border-gray-200 p-3">
        {activeSubTab === 'graphics' && (
          <GraphicsEditor
            key={documentKey}
            graphics={graphics}
            onChange={onGraphicsChange}
            activeGraphicId={activeGraphicId}
            onActiveChange={onActiveGraphicChange}
            currentPageIndex={currentPageIndex}
            totalPages={totalPages}
            pageSize={pageSize}
          />
        )}
        {activeSubTab === 'watermark' && (
          <WatermarkEditor config={watermark} onChange={onWatermarkChange} currentPageIndex={currentPageIndex} totalPages={totalPages} />
        )}
        {activeSubTab === 'content' && (
          <ContentEditPanel
            isRecognizing={isRecognizing}
            hasRecognized={hasRecognized}
            items={recognizedItems}
            selectedItem={selectedContentItem}
            edits={contentEdits}
            onUpsertEdit={onUpsertContentEdit}
            onRemoveEdit={onRemoveContentEdit}
            onSelectItem={onSelectContentItem}
          />
        )}
        {activeSubTab === 'textbox' && (
          <TextBoxEditor
            textBoxes={textBoxes}
            onChange={onTextBoxesChange}
            totalPages={totalPages}
            activeTextBoxId={activeTextBoxId}
            onActiveChange={onActiveTextBoxChange}
          />
        )}
        {activeSubTab === 'header-footer' && (
          <HeaderFooterEditor settings={headerFooter} onChange={onHeaderFooterChange} />
        )}
        {activeSubTab === 'page-number' && (
          <PageNumberEditor
            config={pageNumbering}
            onChange={onPageNumberingChange}
            totalPages={totalPages}
          />
        )}
      </div>

      <div className="space-y-2">
        <ImageExportSettings
          options={imageExportOptions}
          totalPages={totalPages}
          selectedCount={selectedPageCount}
          onChange={onImageExportOptionsChange}
        />
        <RecipeManager
          textBoxes={textBoxes}
          headerFooter={headerFooter}
          pageNumbering={pageNumbering}
          imageExportOptions={imageExportOptions}
          onApply={onApplyRecipe}
        />
        <button
          onClick={onSavePdf}
          disabled={isSavingPdf || isExportingPng}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-amber-600 px-4 py-3 font-medium text-white transition-colors hover:bg-amber-700 disabled:opacity-50"
        >
          <Save className="h-5 w-5" />
          {isSavingPdf ? 'PDFを保存中...' : '編集済みPDFを保存'}
        </button>
        <button
          onClick={onExportPng}
          disabled={isSavingPdf || isExportingPng}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 font-medium text-blue-700 transition-colors hover:bg-blue-100 disabled:opacity-50"
        >
          <ImageIcon className="h-5 w-5" />
          {isExportingPng ? 'PNGを生成中...' : '編集結果をPNGで出力'}
        </button>
        <p className="text-xs text-gray-500">
          メイン出力はPDF保存です。必要な場合のみ同じ編集結果をPNGに変換できます。
        </p>
      </div>
    </div>
  );
}
