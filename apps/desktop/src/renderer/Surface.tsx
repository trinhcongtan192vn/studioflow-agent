import { createContext, useContext, type ReactNode } from 'react';

/** 068: màn được mở như trang của khung app (thanh điều hướng trái) thay vì hộp thoại chồng lên nhau. */
export const AsPage = createContext(false);

/**
 * Vỏ của một màn (Cài đặt, Kênh, Autopilot, Lịch sử phiên…): trong `AsPage` → trang chiếm vùng chính,
 * ngoài → hộp thoại (bấm nền để đóng).
 */
export function Surface({
  label,
  className = '',
  testId,
  onClose,
  children,
}: {
  label: string;
  className?: string;
  testId?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const page = useContext(AsPage);
  if (page)
    return (
      <section
        className={`page ${className}`}
        role="region"
        aria-label={label}
        data-testid={testId}
      >
        <div className="page-body">{children}</div>
      </section>
    );
  return (
    <div className="modal" onClick={onClose}>
      <div
        className={`card ${className}`}
        role="dialog"
        aria-label={label}
        data-testid={testId}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
