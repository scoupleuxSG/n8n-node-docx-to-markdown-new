import TurndownService from "turndown";
import { JSDOM } from "jsdom";
import sanitizeHtml from "sanitize-html";

interface HtmlToMarkdownOptions {
  /**
   * Whether to preserve tables in the output
   */
  preserveTables?: boolean;
  /**
   * Maximum length of output (0 = no limit)
   */
  maxLength?: number;
  /**
   * Whether to include image alt text
   */
  includeImageAlt?: boolean;
  /**
   * Custom domain whitelist for links and images
   */
  allowedDomains?: string[];
  /**
   * Whether to preserve line breaks
   */
  preserveLineBreaks?: boolean;
}

export function htmlToMarkdown(
  html: string, 
  options: HtmlToMarkdownOptions = {}
): string {
  const {
    preserveTables = false,
    maxLength = 0,
    includeImageAlt = true,
    allowedDomains = [],
    preserveLineBreaks = false
  } = options;

  // Input validation
  if (!html || typeof html !== 'string') {
    return '';
  }

  // Early return for very long content
  if (maxLength > 0 && html.length > maxLength * 10) {
    html = html.substring(0, maxLength * 10);
  }

  // Build allowed tags list
  const allowedTags = [
    "p", "br", "b", "strong", "i", "em", "a",
    "ul", "ol", "li", "blockquote", "code",
    "pre", "h1", "h2", "h3", "h4", "h5", "h6",
    "img", "hr"
  ];

  if (preserveTables) {
    allowedTags.push("table", "thead", "tbody", "tr", "th", "td");
  }

  // 1. Sanitize input: remove scripts, styles, and unwanted tags
  const sanitized = sanitizeHtml(html, {
    allowedTags,
    allowedAttributes: {
      a: ["href", "title"],
      img: includeImageAlt ? ["src", "alt", "title"] : ["src", "title"],
    },
    allowedSchemes: ["http", "https", "mailto"],
    allowedSchemesByTag: {
      img: ["http", "https", "data"],
    },
    transformTags: {
      // Convert semantic tags to more basic ones
      "div": preserveLineBreaks ? "p" : "",
      "span": "",
      "section": "p",
      "article": "p",
      "header": "p",
      "footer": "p",
      "aside": "blockquote",
      // Convert heading tags that are too nested
      "h7": "h6",
      "h8": "h6",
    },
    // Filter URLs if domain whitelist is provided
    allowedIframeHostnames: [],
    exclusiveFilter: (frame) => {
      if (allowedDomains.length === 0) return false;
      
      if (frame.tag === 'a' && frame.attribs.href) {
        try {
          const url = new URL(frame.attribs.href);
          return !allowedDomains.includes(url.hostname);
        } catch {
          return true; // Remove malformed URLs
        }
      }
      return false;
    }
  });

  // 2. Convert sanitized HTML into a DOM
  const dom = new JSDOM(sanitized);
  const document = dom.window.document;

  // Pre-processing: clean up empty elements and normalize whitespace
  const walker = document.createTreeWalker(
    document.body,
    dom.window.NodeFilter.SHOW_ELEMENT,
    {
      acceptNode: (node) => {
        const element = node as Element;
        // Remove empty paragraphs and divs
        if (['p', 'div'].includes(element.tagName.toLowerCase()) && 
            !element.textContent?.trim()) {
          return dom.window.NodeFilter.FILTER_REJECT;
        }
        return dom.window.NodeFilter.FILTER_ACCEPT;
      }
    }
  );

  const elementsToRemove: Element[] = [];
  let node;
  while (node = walker.nextNode()) {
    const element = node as Element;
    if (!element.textContent?.trim()) {
      elementsToRemove.push(element);
    }
  }

  elementsToRemove.forEach(el => el.remove());

  // 3. Initialize Turndown with enhanced options
  const turndown = new TurndownService({
    headingStyle: "atx", // # Heading
    codeBlockStyle: "fenced", // ``` code blocks
    emDelimiter: "*", // *italic*
    strongDelimiter: "**", // **bold**
    bulletListMarker: "-", // - list
    linkStyle: "inlined", // [text](url)
    linkReferenceStyle: "full", // [text][1] [1]: url
    hr: "---", // horizontal rule
    br: preserveLineBreaks ? "\n" : " ", // line break handling
  });

  // Custom rules for better conversion
  turndown.addRule('removeEmptyParagraphs', {
    filter: ['p'],
    replacement: (content) => {
      const trimmed = content.trim();
      return trimmed ? `\n\n${trimmed}\n\n` : '';
    }
  });

  // Handle email-specific patterns
  turndown.addRule('emailLinks', {
    filter: (node) => {
      if (node.nodeName !== 'A') return false;
      const element = node as HTMLAnchorElement;
      const href = element.getAttribute('href');
      return !!(href && (href.includes('safelink.emails') || href.includes('redirect')));
    },
    replacement: (content, node) => {
      // Try to extract the real URL from redirect links
      const element = node as HTMLAnchorElement;
      const href = element.getAttribute('href');
      if (href) {
        try {
          const url = new URL(href);
          const destination = url.searchParams.get('destination');
          if (destination) {
            const decodedUrl = decodeURIComponent(destination);
            return `[${content}](${decodedUrl})`;
          }
        } catch {
          // Fallback to original behavior
        }
      }
      return `[${content}](${href})`;
    }
  });

  // Remove unwanted elements that might have slipped through
  turndown.remove(["script", "style", "meta", "link", "noscript", "iframe"]);

  // 4. Convert to Markdown
  let markdown = turndown.turndown(document.body.innerHTML);

  // Post-processing cleanup
  markdown = markdown
    // Remove excessive newlines (more than 2 consecutive)
    .replace(/\n{3,}/g, '\n\n')
    // Remove leading/trailing whitespace
    .trim()
    // Fix spacing around headers
    .replace(/\n+#/g, '\n\n#')
    // Clean up list formatting
    .replace(/\n+(\s*[-*+])/g, '\n$1')
    // Remove empty links
    .replace(/\[]\([^)]*\)/g, '')
    // Clean up multiple spaces
    .replace(/ {2,}/g, ' ');

  // Apply length limit if specified
  if (maxLength > 0 && markdown.length > maxLength) {
    markdown = markdown.substring(0, maxLength) + '...';
  }

  return markdown;
}

/**
 * Simple version of htmlToMarkdown with default options (backward compatible)
 */
export function htmlToMarkdownSimple(html: string): string {
  return htmlToMarkdown(html);
}

/**
 * Email-optimized version with sensible defaults for email content
 */
export function emailToMarkdown(html: string): string {
  return htmlToMarkdown(html, {
    maxLength: 10000, // Limit very long emails
    includeImageAlt: true,
    preserveLineBreaks: false,
    preserveTables: false
  });
}
