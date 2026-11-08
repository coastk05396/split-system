import { fireEvent, screen } from "@testing-library/react";

/** Opens the ticket-shaped search panel the way a User does: by tapping the summary card's route chip. */
export async function openSearchPanel(): Promise<void> {
  const route = await screen.findByRole("button", { name: /^.+ → .+ .+–.+$/ });
  if (route.getAttribute("aria-expanded") === "false") fireEvent.click(route);
}
