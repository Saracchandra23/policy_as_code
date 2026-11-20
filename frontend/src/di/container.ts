import { ControlPlaneController } from "../application/ControlPlaneController";
import { createAuthZenClient } from "../api/authzenClient";

export function createContainer(fetcher: typeof fetch = fetch) {
  const api = createAuthZenClient(fetcher);
  return {
    controller: new ControlPlaneController(api, api, api),
  };
}
