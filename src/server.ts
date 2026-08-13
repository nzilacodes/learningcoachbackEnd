import "./instrument.js";

import { buildApp } from "./app.js";
import { env } from "./config/env.js";

const app = await buildApp();

app
  .listen({ port: env.PORT, host: env.HOST })
  .catch((error) => {
    app.log.error(error);
    process.exit(1);
  });
