import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

/*
 * Shiki is stubbed. Loading the real highlighter in jsdom pulls in six grammars and a regex
 * engine for no benefit — what is under test here is the markdown-to-element mapping and the
 * escaping, not whether Shiki colours TypeScript correctly.
 */
vi.mock("@/lib/markdown/highlighter", () => ({
  resolveLanguage: (tag: string | null) =>
    tag && ["ts", "typescript", "sql"].includes(tag) ? "typescript" : null,
  highlight: () => new Promise<string>(() => {}), // never resolves: keeps the plain fallback
}));

const { Markdown } = await import("./markdown");

describe("markdown rendering", () => {
  it("renders GFM basics", () => {
    render(
      <Markdown
        content={"# Heading\n\nSome **bold** text.\n\n- one\n- two\n\n| a | b |\n|---|---|\n| 1 | 2 |"}
      />,
    );

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Heading");
    expect(screen.getByText("bold").tagName).toBe("STRONG");
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    // GFM tables need remark-gfm; without the plugin this renders as a paragraph of pipes.
    expect(screen.getByRole("table")).toBeDefined();
  });

  it("renders strikethrough and task lists from GFM", () => {
    render(<Markdown content={"~~gone~~\n\n- [x] done\n- [ ] not done"} />);

    expect(screen.getByText("gone").tagName).toBe("DEL");
    const boxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    expect(boxes).toHaveLength(2);
    expect(boxes[0]!.checked).toBe(true);
    expect(boxes[1]!.checked).toBe(false);
    // Read-only on purpose: ticking would have to rewrite the markdown source, and a checkbox
    // that looks interactive and does nothing is worse than one that plainly is not.
    expect(boxes[0]!.readOnly).toBe(true);
  });

  /*
   * THE SECURITY TEST. A task description arrives over the sync channel, so it is not simply
   * "the user's own trusted input". react-markdown escapes embedded HTML unless `rehype-raw` is
   * added — this asserts that nobody adds it later for a `<details>` or a `<kbd>`.
   */
  it("does not execute embedded HTML", () => {
    const { container } = render(
      <Markdown content={'<img src="x" onerror="alert(1)">\n\n<script>alert(2)</script>'} />,
    );

    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    // The raw text is shown instead, which is the correct, visible failure mode.
    expect(container.textContent).toContain("script");
  });

  it("does not turn a javascript: link into a live one", () => {
    const { container } = render(<Markdown content={"[click](javascript:alert(1))"} />);
    const link = container.querySelector("a");
    // react-markdown sanitises dangerous protocols in its default URL transform.
    expect(link?.getAttribute("href") ?? "").not.toContain("javascript:");
  });

  it("opens external links safely", () => {
    render(<Markdown content={"[docs](https://example.com)"} />);
    const link = screen.getByRole("link");

    expect(link.getAttribute("target")).toBe("_blank");
    // noreferrer implies noopener, which stops the opened page reaching back through
    // window.opener.
    expect(link.getAttribute("rel")).toContain("noreferrer");
  });

  it("renders nothing for empty or whitespace-only content", () => {
    const { container } = render(<Markdown content={"   \n  "} />);
    expect(container.firstChild).toBeNull();
  });
});

describe("code fences", () => {
  it("distinguishes inline code from a fenced block", () => {
    const { container } = render(
      <Markdown content={"Use `npm i` first.\n\n```ts\nconst a = 1;\n```"} />,
    );

    // Inline code stays a bare <code>; a fence gets the block container with a <pre>.
    expect(container.querySelectorAll("pre")).toHaveLength(1);
    expect(container.textContent).toContain("npm i");
    expect(container.textContent).toContain("const a = 1;");
  });

  it("treats an untagged multi-line fence as a block", () => {
    /*
     * react-markdown v10 dropped the `inline` prop, and an untagged fence carries no
     * `language-*` class either — so the only thing separating it from inline code is the
     * newline. Without that check every ``` block with no language renders inline.
     */
    const { container } = render(<Markdown content={"```\nline one\nline two\n```"} />);
    expect(container.querySelectorAll("pre")).toHaveLength(1);
  });

  it("does not leave a trailing blank line in a block", () => {
    const { container } = render(<Markdown content={"```ts\nconst a = 1;\n```"} />);
    // Markdown fences always end with a newline before the closing ```; keeping it renders an
    // empty final line in every single block.
    expect(container.querySelector("code")?.textContent).toBe("const a = 1;");
  });

  it("renders an unsupported language as plain text rather than failing", () => {
    const { container } = render(<Markdown content={"```haskell\nmain = putStrLn \"hi\"\n```"} />);
    expect(container.querySelectorAll("pre")).toHaveLength(1);
    expect(container.textContent).toContain("putStrLn");
  });
});
