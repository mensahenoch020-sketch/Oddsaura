import type { Metadata } from "next";
import PublicAssistant from "./public-assistant";
import "./assistant/assistant.css";
import "./landing.css";

export const metadata: Metadata = {
  title: "OddsAura | Football predictions and bookmaker codes",
  description: "Ask for football picks, build target odds and move supported booking codes between bookmakers.",
  alternates: { canonical: "/" },
};

export default function LandingPage() {
  return <PublicAssistant />;
}
