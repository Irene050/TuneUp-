import type {
  Dispatch,
  SetStateAction,
} from 'react';

export type AlertType = 'success' | 'error' | 'info';

export type AlertDetails = {
  title: string;
  message: string;
  type: AlertType;
  buttonLabel?: string;
  onConfirm?: () => void;
};

export function closeAlert(
  alert: AlertDetails | null,
  setAlert: Dispatch<SetStateAction<AlertDetails | null>>,
): void {
  const callback = alert?.onConfirm;
  setAlert(null);
  callback?.();
}
