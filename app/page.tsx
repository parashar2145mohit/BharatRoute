import type { Metadata } from "next";
import BharatRouteApp from "./BharatRouteApp";

export const metadata: Metadata = {
  title: "BharatRoute — India, on your way",
  description: "Search places, explore nearby and find the best route anywhere in India.",
};

export default function Home() {
  return <BharatRouteApp />;
}
