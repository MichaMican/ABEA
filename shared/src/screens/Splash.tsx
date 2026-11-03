import { Logo } from "../components/Logo";
import { Spinner } from "../components/ui";

export function Splash({ message }: { message?: string }) {
  return (
    <div className="splash">
      <div className="splash__logo">
        <Logo size={84} />
      </div>
      <div className="splash__name">ABEA</div>
      <div className="splash__status">
        <Spinner size={18} />
        <span>{message ?? "Loading…"}</span>
      </div>
    </div>
  );
}
