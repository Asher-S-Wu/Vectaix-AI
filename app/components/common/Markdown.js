"use client";

import NextImage from "next/image";
import { scopeGuestUrl } from "@/lib/client/guestAccess";
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
  // 使用 ref 记住上一次的 enableHighlight 值，避免重复触发
  const prevEnableRef = useRef(enableHighlight);
  const [actualHighlight, setActualHighlight] = useState(enableHighlight);

  useEffect(() => {
    // 只有当从 false -> true 时才延迟启用，避免闪烁
    if (!prevEnableRef.current && enableHighlight) {
      const timer = setTimeout(() => setActualHighlight(true), 50);
      prevEnableRef.current = enableHighlight;
      return () => clearTimeout(timer);
    }
    // 其他情况直接同步
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
          img: ({ node, src, alt, ...props }) => <NextImage {...props} src={scopeGuestUrl(src)} alt={alt || "图片"} width={1200} height={800} unoptimized className="h-auto max-w-full" />,
          a: ({ node, href, children, ...props }) => <a {...props} href={scopeGuestUrl(href)}>{children}</a>,
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
              <div className="relative group/code my-4 rounded-xl overflow-hidden border border-zinc-200/50 shadow-sm">
                <div className="flex items-center justify-between px-4 py-2 bg-zinc-50 dark:bg-zinc-900 border-b border-zinc-200/50 text-[11px] font-bold text-zinc-500 uppercase tracking-widest">
                  <span>{lang || "code"}</span>
                  <CodeCopyButton text={rawText} />
                </div>
                <pre className="!bg-zinc-900 !m-0 !rounded-none p-4 overflow-x-auto fade-scrollbar">
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
  const [copied, setCopied] = useState(false);
  
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  return (
    <button
      onClick={handleCopy}
      className="flex items-center gap-1 hover:text-primary transition-colors"
    >
      {copied ? (
        <>
          <Check size={12} />
          <span>已复制</span>
        </>
      ) : (
        <>
          <Copy size={12} />
          <span>复制</span>
        </>
      )}
    </button>
  );
}
