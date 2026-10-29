import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { getLocale, t } from "../i18n/messages.js";
import privacySource from "../legal/privacy.md?raw";
import termsSource from "../legal/terms.md?raw";

/*
 * /privacy and /terms (decisions 26, 28, 29). The copy in src/legal/*.md is a good-faith
 * draft written from those product decisions and a research summary; it is NOT legal
 * advice and has not been reviewed by a lawyer.
 *
 * The pages are static and ship with the app. The Markdown is the source of record; this
 * renders only the subset it uses: `#`/`##` headings, paragraphs, `-` lists and
 * `[text](href)` links. HTML comments are dropped.
 */

type Block = { kind: "h1" | "h2" | "p"; text: string } | { kind: "ul"; items: string[] };

function parsePolicy(source: string): Block[] {
  const blocks: Block[] = [];
  const text = source.replace(/<!--[\s\S]*?-->/g, "");
  for (const chunk of text.split(/\n\s*\n/)) {
    const lines = chunk
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "");
    const first = lines[0];
    if (first === undefined) continue;
    if (first.startsWith("## ")) blocks.push({ kind: "h2", text: first.slice(3) });
    else if (first.startsWith("# ")) blocks.push({ kind: "h1", text: first.slice(2) });
    else if (first.startsWith("- ")) {
      blocks.push({ kind: "ul", items: lines.map((line) => line.replace(/^- /, "")) });
    } else blocks.push({ kind: "p", text: lines.join("") });
  }
  return blocks;
}

function Inline({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  const pattern = /\[([^\]]+)\]\(([^)]+)\)/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const [whole, label = "", href = ""] = match;
    parts.push(text.slice(last, match.index));
    parts.push(
      href.startsWith("/") ? (
        <Link key={match.index} to={href} className="font-bold text-sprout-600 underline">
          {label}
        </Link>
      ) : (
        <a key={match.index} href={href} className="font-bold text-sprout-600 underline">
          {label}
        </a>
      ),
    );
    last = match.index + whole.length;
  }
  parts.push(text.slice(last));
  return <>{parts}</>;
}

function PolicyPage({ source }: { source: string }) {
  return (
    <main className="mx-auto w-full max-w-2xl px-5 pt-8 pb-16 leading-relaxed">
      <Link to="/" className="inline-flex items-center gap-1 text-sm font-bold text-sprout-600">
        <ArrowLeft aria-hidden="true" className="size-4" />
        {t("legal.back")}
      </Link>
      {getLocale() === "en" && (
        <p role="note" className="mt-4 rounded-2xl bg-peach/60 px-4 py-3 text-sm font-bold">
          {t("legal.englishNotice")}
        </p>
      )}
      {parsePolicy(source).map((block, index) => {
        switch (block.kind) {
          case "h1":
            return (
              <h1 key={index} className="mt-6 text-3xl font-black">
                {block.text}
              </h1>
            );
          case "h2":
            return (
              <h2 key={index} className="mt-8 text-lg font-bold">
                {block.text}
              </h2>
            );
          case "ul":
            return (
              <ul key={index} className="mt-3 list-disc space-y-1 pl-5">
                {block.items.map((item, i) => (
                  <li key={i}>
                    <Inline text={item} />
                  </li>
                ))}
              </ul>
            );
          case "p":
            return (
              <p key={index} className="mt-3">
                <Inline text={block.text} />
              </p>
            );
        }
      })}
    </main>
  );
}

export function PrivacyPage() {
  return <PolicyPage source={privacySource} />;
}

export function TermsPage() {
  return <PolicyPage source={termsSource} />;
}
