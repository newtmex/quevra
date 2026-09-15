import { createServer } from "./index.js";

const server = createServer();
console.log(`${server.name} protocol=${server.protocol.name}`);
