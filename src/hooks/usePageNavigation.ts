import { useEffect, useState } from 'react';
import type { KeyboardEvent } from 'react';

/**
 * 表示中ページ番号（1始まり）とページ番号入力欄の状態を管理する。
 * ページ数が減ったときは最終ページへ戻す。
 */
export function usePageNavigation(pageCount: number) {
  const [currentPage, setCurrentPage] = useState(1);
  const [pageInputValue, setPageInputValue] = useState('1');

  useEffect(() => {
    setPageInputValue(String(currentPage));
  }, [currentPage]);

  useEffect(() => {
    if (pageCount === 0) return;
    if (currentPage > pageCount) setCurrentPage(pageCount);
  }, [currentPage, pageCount]);

  const commitPageInput = () => {
    const page = parseInt(pageInputValue, 10);
    if (!Number.isNaN(page) && page >= 1 && page <= pageCount) {
      setCurrentPage(page);
    } else {
      setPageInputValue(String(currentPage));
    }
  };

  const handlePageInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.currentTarget.blur();
      commitPageInput();
    }
  };

  const goToPreviousPage = () => setCurrentPage((page) => Math.max(1, page - 1));
  const goToNextPage = () => setCurrentPage((page) => Math.min(pageCount, page + 1));

  return {
    currentPage,
    setCurrentPage,
    pageInputValue,
    setPageInputValue,
    commitPageInput,
    handlePageInputKeyDown,
    goToPreviousPage,
    goToNextPage,
  };
}
