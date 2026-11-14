import { useEffect, type MutableRefObject } from 'react';

export function useMountedRefLifecycle(
  mountedRef: MutableRefObject<boolean>,
): void {
  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
    };
  }, [mountedRef]);
}
