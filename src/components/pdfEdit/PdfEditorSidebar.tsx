import { BookOpen, Hash, Image as ImageIcon, Save, Type } from 'lucide-react';
import { TextBoxEditor } from './TextBoxEditor';
import { HeaderFooterEditor } from './HeaderFooterEditor';
import { PageNumberEditor } from './PageNumberEditor';
import type { TextBoxConfig, HeaderFooterSettings, PageNumberingConfig } from '../../types/pdfEdit';

export type EditorSubTab = 'textbox' | 'header-footer' | 'page-number';

interface PdfEditorSidebarProps {
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
  onSavePdf: () => void;
  onExportPng: () => void;
  isSavingPdf: boolean;
  isExportingPng: boolean;
}

const SUB_TABS: { key: EditorSubTab; label: string; icon: typeof Type }[] = [
  { key: 'textbox', label: 'テキストボックス', icon: Type },
  { key: 'header-footer', label: 'ヘッダー/フッター', icon: BookOpen },
  { key: 'page-number', label: 'ページ番号', icon: Hash },
];

export function PdfEditorSidebar({
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
  onSavePdf,
  onExportPng,
  isSavingPdf,
  isExportingPng,
}: PdfEditorSidebarProps) {
  return (
    <div className="shrink-0 space-y-3 lg:w-80">
      <div className="flex overflow-hidden rounded-lg border border-gray-200">
        {SUB_TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.key}
              onClick={() => onActiveSubTabChange(tab.key)}
              className={`flex flex-1 items-center justify-center gap-1 px-2 py-2.5 text-xs font-medium transition-colors ${
                activeSubTab === tab.key
                  ? 'bg-amber-500 text-white'
                  : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{tab.label}</span>
            </button>
          );
        })}
      </div>

      <div className="max-h-[500px] overflow-auto rounded-lg border border-gray-200 p-3">
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
