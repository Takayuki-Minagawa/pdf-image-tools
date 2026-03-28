export type BorderStyle = 'solid' | 'dashed' | 'dotted' | 'none';

export interface TextBoxConfig {
  id: string;
  text: string;
  x: number;       // distance from left edge (pt)
  y: number;       // distance from top edge (pt)
  width: number;   // pt
  height: number;  // pt
  fontSize: number;
  fontColor: string;
  backgroundColor: string; // hex or 'transparent'
  borderStyle: BorderStyle;
  borderWidth: number;
  borderColor: string;
  pageIndex: number; // 0-based, -1 = all pages
}

export interface HeaderFooterConfig {
  enabled: boolean;
  left: string;
  center: string;
  right: string;
  fontSize: number;
  fontColor: string;
  margin: number;
  marginHorizontal: number;
}

export interface HeaderFooterSettings {
  header: HeaderFooterConfig;
  footer: HeaderFooterConfig;
}

export type NumberingFormat = 'numeric' | 'roman-lower' | 'roman-upper' | 'dash-numeric';

export type NumberingPosition =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right';

export interface PageNumberingConfig {
  enabled: boolean;
  startPage: number;   // 1-based: first page to show a number
  startNumber: number; // number to assign to startPage
  format: NumberingFormat;
  position: NumberingPosition;
  fontSize: number;
  fontColor: string;
  prefix: string;
  suffix: string;
  margin: number;
}

export interface PdfEditState {
  textBoxes: TextBoxConfig[];
  headerFooter: HeaderFooterSettings;
  pageNumbering: PageNumberingConfig;
}

export const DEFAULT_HEADER_FOOTER: HeaderFooterSettings = {
  header: {
    enabled: false,
    left: '',
    center: '',
    right: '',
    fontSize: 10,
    fontColor: '#000000',
    margin: 30,
    marginHorizontal: 40,
  },
  footer: {
    enabled: false,
    left: '',
    center: '{{page}} / {{total}}',
    right: '',
    fontSize: 10,
    fontColor: '#666666',
    margin: 30,
    marginHorizontal: 40,
  },
};

export const DEFAULT_PAGE_NUMBERING: PageNumberingConfig = {
  enabled: false,
  startPage: 1,
  startNumber: 1,
  format: 'numeric',
  position: 'bottom-center',
  fontSize: 10,
  fontColor: '#000000',
  prefix: '',
  suffix: '',
  margin: 30,
};

export function createDefaultTextBox(pageIndex: number): TextBoxConfig {
  return {
    id: crypto.randomUUID(),
    text: 'テキスト',
    x: 50,
    y: 50,
    width: 200,
    height: 60,
    fontSize: 12,
    fontColor: '#000000',
    backgroundColor: '#ffffff',
    borderStyle: 'solid',
    borderWidth: 1,
    borderColor: '#000000',
    pageIndex,
  };
}
