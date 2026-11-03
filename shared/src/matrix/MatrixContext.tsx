import { createContext, useContext } from "react";
import type { MatrixClient } from "matrix-js-sdk";

export interface MatrixContextValue {
  client: MatrixClient;
  cryptoEnabled: boolean;
  logout: () => Promise<void>;
}

export const MatrixContext = createContext<MatrixContextValue | null>(null);

export function useMatrix(): MatrixContextValue {
  const ctx = useContext(MatrixContext);
  if (!ctx) throw new Error("useMatrix must be used inside a MatrixContext provider");
  return ctx;
}

export function useMatrixClient(): MatrixClient {
  return useMatrix().client;
}
