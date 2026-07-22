"use client";

import { useState, useEffect, useRef } from "react";
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
          code: ({ node, className, children, inline, ...props }) => {
            const match = /language-(\w+)/.exec(className || "");
            const lang = match ? match[1] : "";
            
            if (inline) {
              return <code className="bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded text-[13px] font-mono text-primary" {...props}>{children}</code>;
            }

            return (
              <div className="relative group/code my-4 rounded-xl overflow-hidden border border-zinc-200/50 shadow-sm">
                <div className="flex items-center justify-between px-4 py-2 bg-zinc-50 dark:bg-zinc-900 border-b border-zinc-200/50 text-[11px] font-bold text-zinc-500 uppercase tracking-widest">
                  <span>{lang || "code"}</span>
                  <CodeCopyButton text={String(children).replace(/\n$/, "")} />
                </div>
                <pre className="!bg-zinc-900 !m-0 !rounded-none p-4 overflow-x-auto fade-scrollbar">
                  <code className={`${className} !bg-transparent text-[13.5px] leading-relaxed`} {...props}>
                    {children}
                  </code>
                </pre>
              </div>
            );
          },
          pre: ({ children }) => <>{children}</>,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
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
