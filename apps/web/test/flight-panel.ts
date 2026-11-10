import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { expect } from "vitest";
import { currentRouter } from "./render-app.js";

const SHEET = /^(Search sheet|搜尋面板)$/;

/** Opens the 搜尋面板 the way a User does: by tapping the summary row's route chip. */
export async function openSearchPanel(): Promise<void> {
  if (screen.queryByRole("dialog", { name: SHEET })) return;
  const card = await screen.findByRole("region", { name: /^(Search summary|搜尋摘要)$/ });
  const chip = within(card).getByRole("button");
  // The chip is off while a search runs.
  await waitFor(() => {
    expect(chip).toBeEnabled();
  });
  fireEvent.click(chip);
  await screen.findByRole("dialog", { name: SHEET });
}

/** Opens the passengers sheet, which also holds the budget, theme, rules and today's highlights. */
export async function openFilters(): Promise<void> {
  await openSearchPanel();
  fireEvent.click(
    await screen.findByRole("button", { name: /^(Passengers and cabin|旅客與艙等)/ }),
  );
}

/**
 * Searches a 小芽 prompt the way the Search key hands one over once a spoken sentence is turned into
 * text (the voice flow itself is covered by the 語音搜尋 tests, which are slow by design).
 */
export async function askPrompt(prompt: string): Promise<void> {
  await screen.findByRole("region", { name: /^(Search summary|搜尋摘要)$/ });
  const router = currentRouter();
  await router.navigate("/travel", { state: { prompt } });
  // The page clears the hand-over once it has started the search.
  await waitFor(() => {
    expect(router.state.location.state).toBeNull();
  });
}
