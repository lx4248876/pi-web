"use client";

import { useEffect, useRef, useState } from "react";
import { encodeFilePathForApi } from "@/lib/file-paths";

/**
 * 订阅文件 SSE watch：文件变化触发 onChange，返回是否已连接（live）。
 * 三个 viewer（image/audio/text）共用同一套 EventSource 生命周期。
 */
export function useFileWatch(
  filePath: string,
  onChange: (event: MessageEvent) => void,
): boolean {
  const [watching, setWatching] = useState(false);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    setWatching(false);
    const encoded = encodeFilePathForApi(filePath);
    const es = new EventSource(`/api/files/${encoded}?type=watch`);

    es.addEventListener("connected", () => setWatching(true));
    es.addEventListener("change", (e) => onChangeRef.current(e as MessageEvent));
    es.addEventListener("error", () => setWatching(false));
    es.onerror = () => setWatching(false);

    return () => {
      es.close();
    };
  }, [filePath]);

  return watching;
}