/** Per-WebSocket-connection state, attached via `server.upgrade(req, { data })`. */
export interface ConnectionState {
  nodeId?: string;
  entityName?: string;
}
