// Which user the current request or background job is for, so code deep inside (the AI
// providers) can use that user's own API keys without passing the id through every call.
import { AsyncLocalStorage } from "node:async_hooks";

const store = new AsyncLocalStorage<{ userId: string }>();

export const withUser = <T>(userId: string, fn: () => T): T => store.run({ userId }, fn);
export const currentUserId = () => store.getStore()?.userId ?? null;
