import { createContext, useContext } from "react";

export type CloudCtx = { userId: string; email: string; signOut: () => Promise<void> };
export const CloudContext = createContext<CloudCtx | null>(null);
export const useCloudAccount = () => useContext(CloudContext);
