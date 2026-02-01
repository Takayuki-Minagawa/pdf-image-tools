import { useState } from 'react';
import { PdfToImageConverter } from './components/PdfToImageConverter';
import { ImageToPdfConverter } from './components/ImageToPdfConverter';
import { PdfMerger } from './components/PdfMerger';
import { FileText, Image, Github, Combine } from 'lucide-react';

type Tab = 'pdf-to-image' | 'image-to-pdf' | 'pdf-merge';

function App() {
  const [activeTab, setActiveTab] = useState<Tab>('pdf-to-image');

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-5xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg">
                <FileText className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-gray-800">PDF Image Tools</h1>
                <p className="text-sm text-gray-500">PDF・画像変換ツール</p>
              </div>
            </div>
            <a
              href="https://github.com"
              target="_blank"
              rel="noopener noreferrer"
              className="p-2 text-gray-500 hover:text-gray-700 transition-colors"
            >
              <Github className="w-6 h-6" />
            </a>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8">
        <div className="bg-white rounded-2xl shadow-lg overflow-hidden">
          <div className="flex border-b border-gray-200">
            <button
              onClick={() => setActiveTab('pdf-to-image')}
              className={`flex-1 flex items-center justify-center gap-2 px-4 py-4 text-sm font-medium transition-colors ${
                activeTab === 'pdf-to-image'
                  ? 'bg-blue-50 text-blue-600 border-b-2 border-blue-600'
                  : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              <FileText className="w-5 h-5" />
              PDF → 画像
            </button>
            <button
              onClick={() => setActiveTab('image-to-pdf')}
              className={`flex-1 flex items-center justify-center gap-2 px-4 py-4 text-sm font-medium transition-colors ${
                activeTab === 'image-to-pdf'
                  ? 'bg-green-50 text-green-600 border-b-2 border-green-600'
                  : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              <Image className="w-5 h-5" />
              画像 → PDF
            </button>
            <button
              onClick={() => setActiveTab('pdf-merge')}
              className={`flex-1 flex items-center justify-center gap-2 px-4 py-4 text-sm font-medium transition-colors ${
                activeTab === 'pdf-merge'
                  ? 'bg-purple-50 text-purple-600 border-b-2 border-purple-600'
                  : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              <Combine className="w-5 h-5" />
              PDF結合
            </button>
          </div>

          <div className="p-6">
            {activeTab === 'pdf-to-image' ? (
              <PdfToImageConverter />
            ) : activeTab === 'image-to-pdf' ? (
              <ImageToPdfConverter />
            ) : (
              <PdfMerger />
            )}
          </div>
        </div>

        <footer className="mt-8 text-center text-sm text-gray-500">
          <p>すべての処理はブラウザ上で行われます。ファイルがサーバーにアップロードされることはありません。</p>
        </footer>
      </main>
    </div>
  );
}

export default App;
