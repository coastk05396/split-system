import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Avatar } from "./ui.js";

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
