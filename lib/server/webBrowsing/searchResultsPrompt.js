import { escapeXmlAttr, escapeXmlContent } from "@/lib/server/webBrowsing/xmlEscape";

export function searchResultsPrompt(results) {
  if (!Array.isArray(results) || results.length === 0) {
    return "<searchResults>No results found.</searchResults>";
  }

  const items = results
    .map((item) => {
      const attrs = [
        `title="${escapeXmlAttr(item?.title || "")}"`,
        `url="${escapeXmlAttr(item?.url || "")}"`,
      ];

      if (item?.imgSrc) {
        attrs.push(`imgSrc="${escapeXmlAttr(item.imgSrc)}"`);
      }

      if (item?.thumbnail) {
        attrs.push(`thumbnail="${escapeXmlAttr(item.thumbnail)}"`);
      }

      const attrString = attrs.join(" ");
      const content = item?.content ? escapeXmlContent(item.content) : "";
      return content
        ? `  <item ${attrString}>${content}</item>`
        : `  <item ${attrString} />`;
    })
    .join("\n");

  return `<searchResults>\n${items}\n</searchResults>`;
}
