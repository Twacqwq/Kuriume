import { useStoredMediaTitle } from "@/hooks/use-stored-media-title";
import { useEffect, useRef, useState } from "react";

interface StoredMediaTitleProps {
  provider: string;
  externalId: string;
  fallback: string;
  className?: string;
}

export function StoredMediaTitle(props: StoredMediaTitleProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(entry.isIntersecting),
      { root: element.closest("main"), rootMargin: "80px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <span ref={ref} className={props.className}>
      {visible ? <VisibleStoredMediaTitle {...props} /> : props.fallback}
    </span>
  );
}

function VisibleStoredMediaTitle({ provider, externalId, fallback }: StoredMediaTitleProps) {
  const title = useStoredMediaTitle(provider, externalId, fallback);
  return <span title={title}>{title}</span>;
}
