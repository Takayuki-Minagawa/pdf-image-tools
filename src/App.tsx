import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { CircleHelp, Combine, FileStack, FileText, Github, Image, Pencil } from 'lucide-react';
import { PurposeGuide } from './components/PurposeGuide';
import { PwaStatus } from './components/PwaStatus';
import { subscribePdfEditorHandoff } from './utils/workflowHandoff';

const ImageToPdfConverter = lazy(() => import('./components/ImageToPdfConverter'));
const PdfMerger = lazy(() => import('./components/PdfMerger'));
const PdfEditor = lazy(() => import('./components/PdfEditor'));
const BatchProcessor = lazy(() => import('./components/BatchProcessor'));

export type ToolTab = 'image-to-pdf' | 'pdf-merge' | 'pdf-edit' | 'batch';

const ACTIVE_TAB_STORAGE_KEY = 'pdf-image-tools.active-tab';
const GUIDE_STORAGE_KEY = 'pdf-image-tools.guide-seen';

const TABS = [
  { id: 'pdf-edit', label: 'PDF編集', icon: Pencil, activeClass: 'bg-amber-50 text-amber-700 border-amber-600' },
  { id: 'pdf-merge', label: 'PDF結合', icon: Combine, activeClass: 'bg-purple-50 text-purple-700 border-purple-600' },
  { id: 'image-to-pdf', label: '画像 → PDF', icon: Image, activeClass: 'bg-green-50 text-green-700 border-green-600' },
  { id: 'batch', label: 'バッチ', icon: FileStack, activeClass: 'bg-cyan-50 text-cyan-700 border-cyan-600' },
] satisfies Array<{
  id: ToolTab;
  label: string;
  icon: typeof Pencil;
  activeClass: string;
}>;

function isToolTab(value: string | null): value is ToolTab {
  return TABS.some((tab) => tab.id === value);
}

function readPreference(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function savePreference(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // ストレージが無効でも、現在のセッションでは引き続き利用できる。
  }
}

function getInitialTab(): ToolTab {
  const hashTab = window.location.hash.replace(/^#/, '');
  if (isToolTab(hashTab)) return hashTab;

  const savedTab = readPreference(ACTIVE_TAB_STORAGE_KEY);
  return isToolTab(savedTab) ? savedTab : 'pdf-edit';
}

function App() {
  const [activeTab, setActiveTab] = useState<ToolTab>(getInitialTab);
  const [mountedTabs, setMountedTabs] = useState<Set<ToolTab>>(() => new Set([getInitialTab()]));
  const [isGuideOpen, setIsGuideOpen] = useState(
    () => readPreference(GUIDE_STORAGE_KEY) !== 'true',
  );
  const tabRefs = useRef<Record<ToolTab, HTMLButtonElement | null>>({
    'pdf-edit': null,
    'pdf-merge': null,
    'image-to-pdf': null,
    batch: null,
  });

  useEffect(() => {
    savePreference(ACTIVE_TAB_STORAGE_KEY, activeTab);
    window.history.replaceState(null, '', `#${activeTab}`);
  }, [activeTab]);

  const selectTab = useCallback((tab: ToolTab, focus = false) => {
    setMountedTabs((current) => {
      if (current.has(tab)) return current;
      const next = new Set(current);
      next.add(tab);
      return next;
    });
    setActiveTab(tab);
    if (focus) requestAnimationFrame(() => tabRefs.current[tab]?.focus());
  }, []);

  useEffect(() => subscribePdfEditorHandoff(() => selectTab('pdf-edit')), [selectTab]);

  const handleTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, currentTab: ToolTab) => {
    const currentIndex = TABS.findIndex((tab) => tab.id === currentTab);
    let nextIndex = currentIndex;

    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      nextIndex = (currentIndex + 1) % TABS.length;
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      nextIndex = (currentIndex - 1 + TABS.length) % TABS.length;
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = TABS.length - 1;
    } else {
      return;
    }

    event.preventDefault();
    selectTab(TABS[nextIndex].id, true);
  };

  const dismissGuide = () => {
    savePreference(GUIDE_STORAGE_KEY, 'true');
    setIsGuideOpen(false);
  };

  const startFromGuide = (tab: ToolTab) => {
    dismissGuide();
    selectTab(tab);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      <a
        href="#main-content"
        className="sr-only z-50 rounded-md bg-white px-4 py-2 text-sm font-semibold text-gray-900 shadow focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        メインコンテンツへ移動
      </a>

      <header className="border-b border-gray-200 bg-white shadow-sm">
        <div className="mx-auto max-w-5xl px-4 py-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 p-2">
                <FileText className="h-6 w-6 text-white" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <h1 className="truncate text-xl font-bold text-gray-800">PDF Image Tools</h1>
                <p className="text-sm text-gray-500">PDF・画像を端末内で安全に処理</p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={() => setIsGuideOpen(true)}
                className="flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                aria-haspopup="dialog"
              >
                <CircleHelp className="h-5 w-5" aria-hidden="true" />
                <span className="hidden sm:inline">使い方</span>
              </button>
              <a
                href="https://github.com/Takayuki-Minagawa/pdf-image-tools"
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-lg p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                aria-label="GitHubでソースコードを開く（新しいタブ）"
              >
                <Github className="h-6 w-6" aria-hidden="true" />
              </a>
            </div>
          </div>
        </div>
      </header>

      <PwaStatus />

      <main id="main-content" className="mx-auto max-w-5xl px-4 py-8" tabIndex={-1}>
        <div className="overflow-hidden rounded-2xl bg-white shadow-lg">
          <div
            role="tablist"
            aria-label="使用するPDFツール"
            className="flex border-b border-gray-200"
          >
            {TABS.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  ref={(element) => {
                    tabRefs.current[tab.id] = element;
                  }}
                  id={`tab-${tab.id}`}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  aria-controls={`panel-${tab.id}`}
                  tabIndex={isActive ? 0 : -1}
                  onClick={() => selectTab(tab.id)}
                  onKeyDown={(event) => handleTabKeyDown(event, tab.id)}
                  className={`flex min-w-0 flex-1 items-center justify-center gap-1.5 border-b-2 px-2 py-4 text-sm font-medium transition-colors focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 sm:gap-2 sm:px-4 ${
                    isActive
                      ? tab.activeClass
                      : 'border-transparent text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                  }`}
                >
                  <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
                  <span className="truncate">{tab.label}</span>
                </button>
              );
            })}
          </div>

          <Suspense
            fallback={
              <div className="flex h-64 items-center justify-center text-gray-500" role="status">
                読み込み中...
              </div>
            }
          >
            {mountedTabs.has('pdf-edit') && (
              <section
                id="panel-pdf-edit"
                role="tabpanel"
                aria-labelledby="tab-pdf-edit"
                hidden={activeTab !== 'pdf-edit'}
                className="p-4 sm:p-6"
              >
                <PdfEditor />
              </section>
            )}
            {mountedTabs.has('pdf-merge') && (
              <section
                id="panel-pdf-merge"
                role="tabpanel"
                aria-labelledby="tab-pdf-merge"
                hidden={activeTab !== 'pdf-merge'}
                className="p-4 sm:p-6"
              >
                <PdfMerger />
              </section>
            )}
            {mountedTabs.has('image-to-pdf') && (
              <section
                id="panel-image-to-pdf"
                role="tabpanel"
                aria-labelledby="tab-image-to-pdf"
                hidden={activeTab !== 'image-to-pdf'}
                className="p-4 sm:p-6"
              >
                <ImageToPdfConverter />
              </section>
            )}
            {mountedTabs.has('batch') && (
              <section
                id="panel-batch"
                role="tabpanel"
                aria-labelledby="tab-batch"
                hidden={activeTab !== 'batch'}
                className="p-4 sm:p-6"
              >
                <BatchProcessor />
              </section>
            )}
          </Suspense>
        </div>

        <footer className="mt-8 text-center text-sm text-gray-500">
          <p>
            すべての処理はブラウザ上で行われます。ファイルがサーバーにアップロードされることはありません。
          </p>
        </footer>
      </main>

      <PurposeGuide open={isGuideOpen} onClose={dismissGuide} onSelect={startFromGuide} />
    </div>
  );
}

export default App;
