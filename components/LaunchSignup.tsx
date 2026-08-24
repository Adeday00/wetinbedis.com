import { ArrowRight } from "@phosphor-icons/react/dist/ssr";
import TrackedAppStoreLink from "@/components/TrackedAppStoreLink";

export default function LaunchSignup() {
  return (
    <TrackedAppStoreLink className="launch-cta app-store-cta">
      Download on the App Store
      <ArrowRight size={19} weight="bold" aria-hidden="true" />
    </TrackedAppStoreLink>
  );
}
