import { fireEvent, screen, within } from "@testing-library/react";

/** Opens the ticket-shaped search panel the way a User does: by tapping the summary card's route chip. */
export async function openSearchPanel(): Promise<void> {
  const card = await screen.findByRole("region", { name: /^(Search summary|搜尋摘要)$/ });
  // The chip is the card's only button that reports expanded state; its text varies with the search.
  const route = within(card)
    .getAllByRole("button")
    .find((button) => button.hasAttribute("aria-expanded"));
  if (route?.getAttribute("aria-expanded") === "false") fireEvent.click(route);
}
