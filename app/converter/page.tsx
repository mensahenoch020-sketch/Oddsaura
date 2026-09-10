import ProductNavigation from "../product-navigation";
import ConverterForm from "./converter-form";
import "./converter.css";
import "../compact-theme.css";
export default function ConverterPage() {
  return <main className="converter-page">
    <ProductNavigation active="converter" />
    <section className="converter-hero"><span>Secondary tool</span><h1>Convert a booking code</h1><p>Use this form when you prefer manual controls. In the main assistant, you can also write the source code and destination bookmaker naturally.</p></section>
    <ConverterForm />
  </main>;
}
