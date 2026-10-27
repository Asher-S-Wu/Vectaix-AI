"use client";

import { useI18n } from "@/lib/client/i18n";
import NextImage from "next/image";
import { useState, useEffect, useRef, cloneElement } from "react";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import remarkGfm from "remark-gfm";
import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import { Copy, Check } from "lucide-react";

// Sanitize user markdown before rendering KaTeX/highlight output
const sanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
  },
};

const codeAttributes = Array.isArray(defaultSchema.attributes?.code)
  ? [...defaultSchema.attributes.code]
  : [];
const codeClassIndex = codeAttributes.findIndex(
  (entry) => Array.isArray(entry) && entry[0] === "className"
);

if (codeClassIndex >= 0) {
  const current = codeAttributes[codeClassIndex];
  codeAttributes[codeClassIndex] = [
    "className",
    ...current.slice(1),
    "math-inline",
    "math-display",
  ];
} else {
  codeAttributes.push(["className", "math-inline", "math-display"]);
}

sanitizeSchema.attributes.code = codeAttributes;

export default function Markdown({
  children,
  className = "",
  enableHighlight = true,
  enableMath = false,
}) {
  const { t } = useI18n();
  const prevEnableRef = useRef(enableHighlight);
  const [actualHighlight, setActualHighlight] = useState(enableHighlight);

  useEffect(() => {
    // 只有当从 false -> true 时才延迟启用，避免闪烁
    if (!prevEnableRef.current && enableHighlight) {
      const timer = setTimeout(() => setActualHighlight(true), 50);
      prevEnableRef.current = enableHighlight;
      return () => clearTimeout(timer);
    }
    setActualHighlight(enableHighlight);
    prevEnableRef.current = enableHighlight;
  }, [enableHighlight]);

  const remarkPlugins = enableMath ? [remarkMath, remarkGfm] : [remarkGfm];
  const rehypePlugins = [[rehypeSanitize, sanitizeSchema]];

  if (enableMath) {
    rehypePlugins.push([rehypeKatex, { strict: "ignore" }]);
  }

  if (actualHighlight) {
    rehypePlugins.push(rehypeHighlight);
  }

  return (
    <div
      className={`prose max-w-none ${className}`}
    >
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        components={{
          img: ({ node, src, alt, width, height, ...props }) => <NextImage {...props} src={src} alt={alt || t("图片", "Image")} width={0} height={0} sizes="100vw" unoptimized loading="lazy" className="h-auto w-auto max-w-full rounded-lg" />,
          a: ({ node, href, children, ...props }) => {
            const external = typeof href === "string" && /^https?:\/\//i.test(href);
            return <a {...props} href={href} {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>{children}</a>;
          },
          table: ({ children, ...props }) => (
            <div className="table-scroll-wrapper">
              <table {...props}>{children}</table>
            </div>
          ),
          th: ({ children, ...props }) => (
            <th {...props}>
              <div className="table-cell-inner">{children}</div>
            </th>
          ),
          td: ({ children, ...props }) => (
            <td {...props}>
              <div className="table-cell-inner">{children}</div>
            </td>
          ),
          code: ({ node, className, children, ...props }) => (
            <code className={className} {...props}>{children}</code>
          ),
          pre: ({ children }) => {
            const childArray = Array.isArray(children) ? children : [children];
            const codeEl = childArray.find((c) => c && typeof c === "object" && c.props);
            if (!codeEl) return <pre>{children}</pre>;
            const codeClass = codeEl.props.className || "";
            const match = /language-(\w+)/.exec(codeClass);
            const lang = match ? match[1] : "";
            const rawText = extractText(codeEl.props.children).replace(/\n$/, "");
            return (
              <div className="code-block my-4 overflow-hidden rounded-xl">
                <div className="flex items-center justify-between gap-3 px-4 py-1.5 text-xs text-[#9AAAA0]">
                  <span>{lang || t("代码", "Code")}</span>
                  <CodeCopyButton text={rawText} />
                </div>
                <pre className="!m-0 !rounded-none !bg-transparent !border-0 !px-4 !pb-4 !pt-1 overflow-x-auto fade-scrollbar">
                  {cloneElement(codeEl, {
                    className: `${codeClass} !bg-transparent text-[13.5px] leading-relaxed`.trim(),
                  })}
                </pre>
              </div>
            );
          },
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

function extractText(node) {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join("");
  return extractText(node.props?.children);
}

function CodeCopyButton({ text }) {
  const { t } = useI18n();
  const [state, setState] = useState("idle");
  const timerRef = useRef(null);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  const handleCopy = async () => {
    clearTimeout(timerRef.current);
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
    } catch {
      setState("failed");
    }
    timerRef.current = setTimeout(() => setState("idle"), 2000);
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-live="polite"
      className="flex min-h-8 items-center gap-1.5 rounded-md px-2 transition-colors hover:bg-white/10 hover:text-[#F2F5F2]"
    >
      {state === "copied" ? <Check size={13} /> : <Copy size={13} />}
      <span>{state === "copied" ? t("已复制", "Copied") : state === "failed" ? t("复制失败", "Copy failed") : t("复制", "Copy")}</span>
    </button>
  );
}
