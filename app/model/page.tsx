import { notFound } from "next/navigation";

/** Training and calibration stay out of the public product. */
export default function HiddenModelPage() {
  notFound();
}
