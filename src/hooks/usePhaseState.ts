import {
  useCallback,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';

export function usePhaseState<TPhase extends string>(
  initialPhase: TPhase,
): {
  phase: TPhase;
  setPhase: Dispatch<SetStateAction<TPhase>>;
  phaseRef: MutableRefObject<TPhase>;
} {
  const [phase, setPhaseState] = useState<TPhase>(initialPhase);
  const phaseRef = useRef(initialPhase);

  const setPhase = useCallback<Dispatch<SetStateAction<TPhase>>>(
    (nextPhase) => {
      const resolvedPhase =
        typeof nextPhase === 'function'
          ? nextPhase(phaseRef.current)
          : nextPhase;

      phaseRef.current = resolvedPhase;
      setPhaseState(resolvedPhase);
    },
    [],
  );

  return { phase, setPhase, phaseRef };
}