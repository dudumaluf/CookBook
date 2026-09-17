import { useCallback, useRef, useState } from "react";

import type { BlockingDocument } from "@/types/blocking";

const LIMIT = 40;

function cloneDoc(doc: BlockingDocument): BlockingDocument {
  return JSON.parse(JSON.stringify(doc)) as BlockingDocument;
}

/** Linear undo/redo stack for the fullscreen Blocking editor. */
export function useSceneHistory(initial: BlockingDocument) {
  const hist = useRef<BlockingDocument[]>([cloneDoc(initial)]);
  const index = useRef(0);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const sync = () => {
    setCanUndo(index.current > 0);
    setCanRedo(index.current < hist.current.length - 1);
  };

  const push = useCallback((doc: BlockingDocument) => {
    const next = hist.current.slice(0, index.current + 1);
    next.push(cloneDoc(doc));
    if (next.length > LIMIT) next.shift();
    hist.current = next;
    index.current = next.length - 1;
    sync();
  }, []);

  const undo = useCallback((): BlockingDocument | null => {
    if (index.current <= 0) return null;
    index.current -= 1;
    sync();
    return cloneDoc(hist.current[index.current]!);
  }, []);

  const redo = useCallback((): BlockingDocument | null => {
    if (index.current >= hist.current.length - 1) return null;
    index.current += 1;
    sync();
    return cloneDoc(hist.current[index.current]!);
  }, []);

  return { push, undo, redo, canUndo, canRedo };
}
