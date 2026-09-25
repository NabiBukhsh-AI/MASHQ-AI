import { AsyncLocalStorage } from "node:async_hooks";
import type { Role } from "../auth/guards";

export interface RequestContext {
  requestId: string;
  userId?: string;
  orgId?: string;
  role?: Role;
}

export const requestContext = new AsyncLocalStorage<RequestContext>();

export function getRequestContext(): RequestContext | undefined {
  return requestContext.getStore();
}

export function getRequestId(): string | undefined {
  return requestContext.getStore()?.requestId;
}
