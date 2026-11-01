import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Avatar, GroupAvatar, groupGlyph, groupPalette } from "./ui.js";

describe("Avatar", () => {
  it("shows the LINE picture when there is one", () => {
    const { container } = render(<Avatar name="小宇" pictureUrl="https://pic.example/yu.png" />);

    expect(container.querySelector("img")).toHaveAttribute("src", "https://pic.example/yu.png");
    expect(screen.queryByText("小")).toBeNull();
  });

  it("falls back to the initial when the picture fails to load", () => {
    const { container } = render(<Avatar name="小宇" pictureUrl="https://pic.example/gone.png" />);

    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    if (img !== null) fireEvent.error(img);

    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("小")).toBeInTheDocument();
  });

  it("shows the initial without a picture, and never a picture for a Placeholder Member", () => {
    const { container, rerender } = render(<Avatar name="阿哲" />);
    expect(screen.getByText("阿")).toBeInTheDocument();

    rerender(<Avatar name="阿哲" pictureUrl="https://pic.example/x.png" placeholder />);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("阿")).toBeInTheDocument();
  });
});

describe("GroupAvatar", () => {
  it("extracts glyph correctly for English, Chinese, and Emoji", () => {
    expect(groupGlyph("YoYoYo")).toBe("Y");
    expect(groupGlyph("test group")).toBe("T");
    expect(groupGlyph("明天去哪玩")).toBe("明");
    expect(groupGlyph("🏖️ 沖繩耍廢")).toBe("🏖️");
    expect(groupGlyph("   ")).toBe("群");
  });

  it("renders the first character with deterministic palette styling", () => {
    const { rerender } = render(<GroupAvatar name="YoYoYo" groupId="g-1" />);
    expect(screen.getByText("Y")).toBeInTheDocument();

    const palette1 = groupPalette("g-1");
    const el = screen.getByText("Y").parentElement;
    expect(el?.className).toContain(palette1.bg);
    expect(el?.className).toContain(palette1.text);

    rerender(<GroupAvatar name="明天去哪玩" groupId="g-2" />);
    expect(screen.getByText("明")).toBeInTheDocument();
  });

  it("includes spring transition classes for interactive mode", () => {
    const { container } = render(<GroupAvatar name="Test" groupId="g-3" interactive={true} />);
    const span = container.querySelector("span");
    expect(span?.className).toContain("ease-(--ease-spring)");
  });
});
