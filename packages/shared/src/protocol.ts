/**
 * The wire contract shared between the MCP server and the Chrome extension.
 *
 * Messages flow: mcp-server <-> native-host <-> extension. Every message is one of
 * the three shapes below. Nothing here sends or receives — these are types only.
 */

/** A request expecting a matching {@link RpcResponse} with the same `id`. */
export interface RpcRequest<P = unknown> {
  type: "request";
  id: string;
  method: string;
  params?: P;
}

/** A successful response to an {@link RpcRequest}. */
export interface RpcSuccess<R = unknown> {
  type: "response";
  id: string;
  ok: true;
  result: R;
}

/** A failed response to an {@link RpcRequest}. */
export interface RpcError {
  type: "response";
  id: string;
  ok: false;
  error: { code: string; message: string };
}

export type RpcResponse<R = unknown> = RpcSuccess<R> | RpcError;

/** A fire-and-forget notification with no response. */
export interface RpcEvent<P = unknown> {
  type: "event";
  event: string;
  payload?: P;
}

/** Any message that can travel over the transport. */
export type Message = RpcRequest | RpcResponse | RpcEvent;
