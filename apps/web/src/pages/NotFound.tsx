import { Link } from "react-router";
import { TopBar } from "../components/chrome";

export function NotFound() {
  return (
    <div>
      <TopBar links={[{ to: "/", label: "Home", end: true }, { to: "/explore", label: "Explore" }]} />
      <section className="ruled cols-2" style={{ minHeight: "calc(100vh - 56px)" }}>
        <div className="block pad-lg stack" style={{ justifyContent: "flex-end" }}>
          <h1 className="display d-xxl">404</h1>
        </div>
        <div className="pad-lg stack gap-16" style={{ justifyContent: "center" }}>
          <span className="label sq">Not found</span>
          <p className="lead">This field isn't on our map.</p>
          <div>
            <Link to="/" className="btn">
              Back home <span className="arrow">→</span>
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
