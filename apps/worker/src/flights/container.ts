import { Container } from "@cloudflare/containers";

/** One shared stateless flight scraper, sleeping when the 30-minute D1 cache absorbs traffic. */
export class FlightContainer extends Container {
  override defaultPort = 8080;
  override sleepAfter = "10m";
}
