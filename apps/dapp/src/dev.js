import { createDapp } from "./index.js";

const dapp = createDapp();
console.log(`${dapp.name} protocol=${dapp.protocol.name}`);
