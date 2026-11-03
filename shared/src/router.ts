import { useEffect, useState } from "react";

export type Section = "chats" | "contacts" | "settings";

export interface Route {
  section: Section;
  roomId?: string;
  userId?: string;
  panel?: "info";
}

export function parseHash(hash: string): Route {
  const parts = hash.replace(/^#\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
  const [section, id, panel] = parts;
  if (section === "contacts") return { section: "contacts", userId: id };
  if (section === "settings") return { section: "settings" };
  return { section: "chats", roomId: id, panel: panel === "info" ? "info" : undefined };
}

export function buildHash(route: Route): string {
  switch (route.section) {
    case "contacts":
      return route.userId ? `#/contacts/${encodeURIComponent(route.userId)}` : "#/contacts";
    case "settings":
      return "#/settings";
    default:
      if (!route.roomId) return "#/chats";
      return `#/chats/${encodeURIComponent(route.roomId)}${route.panel ? `/${route.panel}` : ""}`;
  }
}

export function navigate(route: Route, opts: { replace?: boolean } = {}): void {
  const hash = buildHash(route);
  if (window.location.hash === hash) return;
  if (opts.replace) {
    window.history.replaceState(null, "", hash);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  } else {
    window.location.hash = hash;
  }
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}

/** Navigates to the parent route (used by mobile back buttons). Returns false at a root route. */
export function navigateUp(route: Route): boolean {
  if (route.section === "chats" && route.panel) {
    navigate({ section: "chats", roomId: route.roomId }, { replace: true });
    return true;
  }
  if (route.section === "chats" && route.roomId) {
    navigate({ section: "chats" }, { replace: true });
    return true;
  }
  if (route.section === "contacts" && route.userId) {
    navigate({ section: "contacts" }, { replace: true });
    return true;
  }
  if (route.section !== "chats") {
    navigate({ section: "chats" }, { replace: true });
    return true;
  }
  return false;
}
