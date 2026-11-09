import type { ReactNode } from "react";
import { parseMarkdownBlocks } from "@/lib/meetingNote";

/**
 * 纪要的只读渲染。
 *
 * 只支持我们自己生成的那么几种语法（标题/列表/表格/粗体），
 * 不引第三方 markdown 库，也不用 dangerouslySetInnerHTML —— 内容来自模型，
 * 拼 HTML 等于给模型开了个注入口子。
 */

function renderInline(text: string): ReactNode[] {
  // 保留分隔符切分，粗体与行内代码之外原样输出
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return (
        <strong key={i} className="font-semibold text-slate-900">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return (
        <code
          key={i}
          className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[0.92em] text-slate-700"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    return part;
  });
}

export function MarkdownView({ markdown }: { markdown: string }) {
  const blocks = parseMarkdownBlocks(markdown);

  if (!blocks.length) {
    return <p className="text-sm leading-7 text-slate-400">（暂无纪要）</p>;
  }

  return (
    <div className="space-y-4">
      {blocks.map((block, i) => {
        if (block.type === "heading") {
          const isTop = block.text.includes("会议概要");
          return (
            <h3
              key={i}
              className={
                isTop
                  ? "text-sm font-semibold text-slate-900"
                  : "mt-1 border-l-2 border-brand-400 pl-2.5 text-sm font-semibold text-slate-900"
              }
            >
              {block.text}
            </h3>
          );
        }

        if (block.type === "para") {
          return (
            <p key={i} className="text-sm leading-7 text-slate-600">
              {renderInline(block.text)}
            </p>
          );
        }

        if (block.type === "list") {
          return (
            <ul key={i} className="space-y-1.5">
              {block.items.map((item, j) => (
                <li key={j} className="flex gap-2 text-sm leading-7 text-slate-600">
                  <span
                    aria-hidden
                    className="mt-[11px] h-1.5 w-1.5 shrink-0 rounded-full bg-brand-300"
                  />
                  <span className="min-w-0 flex-1 break-words">{renderInline(item)}</span>
                </li>
              ))}
            </ul>
          );
        }

        if (block.type === "ordered") {
          return (
            <ol key={i} className="space-y-1.5">
              {block.items.map((item, j) => (
                <li key={j} className="flex gap-2 text-sm leading-7 text-slate-600">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[11px] font-semibold text-slate-500">
                    {j + 1}
                  </span>
                  <span className="min-w-0 flex-1 break-words">{renderInline(item)}</span>
                </li>
              ))}
            </ol>
          );
        }

        if (block.type === "quote") {
          return (
            <blockquote
              key={i}
              className="rounded-r-lg border-l-2 border-brand-300 bg-brand-50/60 px-3 py-2 text-sm leading-7 text-slate-600"
            >
              {renderInline(block.text)}
            </blockquote>
          );
        }

        // 表格：桌面是表格，手机上转成卡片（横向滚动看行动项太难受）
        return (
          <div key={i} className="thin-scroll -mx-1 overflow-x-auto px-1 max-sm:overflow-visible">
            <table className="w-full min-w-[420px] border-collapse text-sm max-sm:block max-sm:min-w-0">
              <thead className="max-sm:hidden">
                <tr className="border-b border-slate-200">
                  {block.head.map((h, j) => (
                    <th
                      key={j}
                      className="whitespace-nowrap px-2 py-2 text-left text-xs font-semibold text-slate-500"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="max-sm:block">
                {block.rows.map((row, j) => (
                  <tr
                    key={j}
                    className="border-b border-slate-100 last:border-0 max-sm:mb-2 max-sm:block max-sm:rounded-xl max-sm:border max-sm:border-slate-200 max-sm:bg-slate-50/60 max-sm:px-3 max-sm:py-2.5 max-sm:last:mb-0"
                  >
                    {row.map((cellText, k) => (
                      <td
                        key={k}
                        data-label={block.head[k]}
                        className="px-2 py-2 align-top leading-6 text-slate-600 first:font-medium first:text-slate-800 max-sm:block max-sm:px-0 max-sm:py-0.5 max-sm:before:mr-2 max-sm:before:text-xs max-sm:before:font-medium max-sm:before:text-slate-400 max-sm:before:content-[attr(data-label)] max-sm:[&:first-child]:before:hidden max-sm:[&:first-child]:text-slate-900"
                      >
                        {renderInline(cellText)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}
