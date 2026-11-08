import { fireEvent, screen } from "@testing-library/react";

/** Opens the ticket-shaped search panel the way a User does: by tapping the route pill. */
export async function openSearchPanel(): Promise<void> {
  const route = await screen.findByRole("button", { name: /^[A-Z]{3} → [A-Z]{3} ・/ });
  if (route.getAttribute("aria-expanded") === "false") fireEvent.click(route);
}
