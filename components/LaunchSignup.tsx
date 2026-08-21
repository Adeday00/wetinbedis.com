import { ArrowRight } from "@phosphor-icons/react/dist/ssr";
import { APP_STORE_URL } from "@/lib/app-store";

export default function LaunchSignup() {
  return (
    <a className="launch-cta app-store-cta" href={APP_STORE_URL}>
      Download on the App Store
      <ArrowRight size={19} weight="bold" aria-hidden="true" />
    </a>
  );
}
