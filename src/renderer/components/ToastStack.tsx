import { AlertTriangle, Check, X } from 'lucide-react';

export interface Toast {
  id: number;
  kind: 'ok' | 'error';
  text: string;
}

/** 同时最多显示 4 条：超出就丢最旧的，避免提示本身变成噪音源。 */
export const TOAST_MAX = 4;

interface Props {
  toasts: Toast[];
  onDismiss: (id: number) => void;
  onClearAll: () => void;
}

/**
 * Toast 栈。
 *
 * 成功自动消失，**失败常驻**——失败需要被读到、被处理，
 * 4 秒后自己消失的错误提示等于没提示。常驻的失败提供「全部关闭」。
 */
export function ToastStack({ toasts, onDismiss, onClearAll }: Props) {
  if (toasts.length === 0) return null;
  const hasError = toasts.some((t) => t.kind === 'error');
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div className={`toast ${t.kind}`} key={t.id}>
          {t.kind === 'ok' ? <Check size={14} className="ico-ok" /> : <AlertTriangle size={14} className="ico-bad" />}
          <span className="toast-text">{t.text}</span>
          <button className="toast-x" title="关闭" onClick={() => onDismiss(t.id)}><X size={13} /></button>
        </div>
      ))}
      {hasError && toasts.length > 1 && (
        <button className="toast-clear" onClick={onClearAll}>全部关闭</button>
      )}
    </div>
  );
}
